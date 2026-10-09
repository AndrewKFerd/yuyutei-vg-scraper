import { memo, useMemo, useState } from 'react'
import { formatPrice } from '../currency'
import { entryAt, formatDate, formatDateTime } from '../history'
import { stockInfo } from '../stock'
import { Segmented } from './controls'

// Hand-rolled inline SVG (no chart library -- the frontend has zero runtime
// dependencies beyond React, and this is one small step chart).
//
// Layout: the SVG stretches to fill its box (preserveAspectRatio="none",
// strokes use vector-effect="non-scaling-stroke" so they stay 1-2px at any
// width), while every piece of text -- axis labels, the readout, the end
// dot -- is plain HTML positioned in % of that same box. That keeps text
// crisp and readable at phone width instead of scaling with the viewBox.

const RANGES = [
  { key: '7d', label: '7D', minutes: 7 * 1440 },
  { key: '30d', label: '30D', minutes: 30 * 1440 },
  { key: 'all', label: 'ALL', minutes: null },
]

const VB_W = 600
const VB_H = 200
// Vertical bands, as fractions of the plot height: the price line lives in
// the top part, faint stock bars in the bottom part, so the two never
// overlap and the line stays readable.
const PRICE_TOP = 0.08
const PRICE_BOTTOM = 0.68
const STOCK_BAND = 0.22
const SOLD_OUT_BAND = 0.025

const pct = (value, total) => `${((value / total) * 100).toFixed(3)}%`

// Only coverage gaps longer than this are shaded. Shorter ones (a skipped
// run or two) are noise at chart scale, and the backfilled early history
// is a string of sparse snapshots that would otherwise grey out nearly the
// whole chart. The "changed between X and Y" text still carries the exact
// precision.
const MIN_SHADED_GAP_MINUTES = 3 * 60
// Light diagonal hatch in currentColor (set via a text-* class), drawn as
// HTML behind the SVG so the stripes stay crisp and 45° at any width.
const GAP_HATCH = 'repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 6px)'

/**
 * Turns the series into drawable segments for [start, end]: the entry in
 * effect at `start`, then every change inside the range, each segment
 * running until the next change (or `end`).
 */
function buildModel(series, coverage, start, end) {
  const base = entryAt(series, start) || series[0]
  const steps = [{ t: start, price: base[1], stock: base[2] }]
  for (const [t, price, stock] of series) {
    if (t > start && t <= end) steps.push({ t, price, stock })
  }
  const segments = steps.map((step, i) => ({ ...step, t1: i + 1 < steps.length ? steps[i + 1].t : end }))

  let minP = Infinity
  let maxP = -Infinity
  let maxStock = 0
  let hasSoldOut = false
  for (const seg of segments) {
    minP = Math.min(minP, seg.price)
    maxP = Math.max(maxP, seg.price)
    if (typeof seg.stock === 'number') {
      maxStock = Math.max(maxStock, seg.stock)
      if (seg.stock === 0) hasSoldOut = true
    }
  }

  // Gaps between coverage spans = stretches when the pipeline wasn't
  // running, so nothing was observed. Long ones only, clipped to the
  // visible range.
  const gaps = []
  for (let i = 1; i < (coverage?.length || 0); i++) {
    if (coverage[i][0] - coverage[i - 1][1] <= MIN_SHADED_GAP_MINUTES) continue
    const g0 = Math.max(coverage[i - 1][1], start)
    const g1 = Math.min(coverage[i][0], end)
    if (g1 > g0) gaps.push([g0, g1])
  }

  const x = (t) => ((t - start) / (end - start)) * VB_W
  const yTop = PRICE_TOP * VB_H
  const yBottom = PRICE_BOTTOM * VB_H
  const y = (p) => (maxP === minP ? (yTop + yBottom) / 2 : yTop + ((maxP - p) / (maxP - minP)) * (yBottom - yTop))

  // Step-after line: yuyu-tei prices jump between fixed tiers and hold, so
  // the line stays flat until the run that saw the new price, then jumps.
  // Never interpolated -- a sloped line would invent prices that never
  // existed.
  let path = `M${x(segments[0].t).toFixed(2)},${y(segments[0].price).toFixed(2)}`
  for (const seg of segments.slice(1)) {
    path += `H${x(seg.t).toFixed(2)}V${y(seg.price).toFixed(2)}`
  }
  path += `H${VB_W}`

  return { segments, minP, maxP, maxStock, hasSoldOut, gaps, x, y, path }
}

function segmentAt(segments, t) {
  let found = segments[0]
  for (const seg of segments) {
    if (seg.t > t) break
    found = seg
  }
  return found
}

function PriceHistoryChart({ series, coverage, lastRun, currency, rates }) {
  const [range, setRange] = useState('all')
  // Minute under the pointer / keyboard cursor, or null when not inspecting.
  const [cursor, setCursor] = useState(null)
  // Whether the cursor was last moved by keyboard: only those moves are
  // announced to screen readers (every pointermove would be chatter).
  const [viaKeyboard, setViaKeyboard] = useState(false)

  const first = series[0][0]
  const end = Math.max(lastRun, series[series.length - 1][0])
  const rangeMinutes = RANGES.find((r) => r.key === range).minutes
  // ALL starts at the card's first observation (usually trackingSince;
  // later for listings first seen after tracking began).
  let start = rangeMinutes === null ? first : Math.max(first, end - rangeMinutes)
  // Defensive: a zero-width domain would divide by zero. (CardModal doesn't
  // render the chart for a listing first seen in the latest run.)
  if (end - start < 1) start = end - 1

  const model = useMemo(() => buildModel(series, coverage, start, end), [series, coverage, start, end])
  const { segments, minP, maxP, maxStock, hasSoldOut, gaps, x, y, path } = model

  const fmt = (p) => formatPrice(p, currency, rates)
  const converted = currency !== 'JPY'
  const last = segments[segments.length - 1]

  const firstP = segments[0].price
  const trend =
    last.price > firstP
      ? `rose from ${fmt(firstP)} to ${fmt(last.price)}`
      : last.price < firstP
        ? `fell from ${fmt(firstP)} to ${fmt(last.price)}`
        : `stayed at ${fmt(last.price)}`
  const summary = `Price history, ${formatDate(start)} to ${formatDate(end)}: ${trend}. Low ${fmt(minP)}, high ${fmt(maxP)}.${
    converted ? ' Converted from JPY at today’s rate.' : ''
  }`

  // Readout: what's under the cursor, or the latest observation. Built as
  // parts so the same words feed the visible line and the screen-reader
  // announcement.
  const cursorSeg = cursor === null ? null : segmentAt(segments, cursor)
  const cursorGap = cursor === null ? null : gaps.find(([a, b]) => cursor > a && cursor < b)
  let readout
  if (cursor === null) {
    readout = { value: fmt(last.price), after: ` · ${stockInfo(last.stock).label} · latest ${formatDateTime(end)}` }
  } else if (cursorGap) {
    readout = {
      before: `Not observed ${formatDate(cursorGap[0])} – ${formatDate(cursorGap[1])} · last seen at `,
      value: fmt(cursorSeg.price),
    }
  } else {
    readout = { value: fmt(cursorSeg.price), after: ` · ${stockInfo(cursorSeg.stock).label} · ${formatDate(cursor)}` }
  }
  const readoutText = `${readout.before || ''}${readout.value}${readout.after || ''}`

  const handlePointer = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    setCursor(start + frac * (end - start))
    setViaKeyboard(false)
  }

  // Arrow keys step between change points (plus the latest observation),
  // so keyboard users get the same readout as pointer users. Stops are
  // deduped -- a change recorded at the last run would otherwise appear
  // twice and trap the cursor -- and each step goes to the nearest stop
  // strictly before/after the cursor, wherever a pointer left it.
  const handleKeyDown = (e) => {
    const stops = [...new Set([...segments.map((seg) => seg.t), end])]
    const at = cursor === null ? end : cursor
    let next
    if (e.key === 'ArrowLeft') next = stops.findLast((t) => t < at) ?? stops[0]
    else if (e.key === 'ArrowRight') next = stops.find((t) => t > at) ?? stops[stops.length - 1]
    else if (e.key === 'Home') next = stops[0]
    else if (e.key === 'End') next = stops[stops.length - 1]
    else return
    e.preventDefault()
    setCursor(next)
    setViaKeyboard(true)
  }

  const singlePrice = minP === maxP
  const stockBandH = STOCK_BAND * VB_H

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          Price history
        </h3>
        <Segmented
          label="Chart range"
          size="sm"
          options={RANGES.map((r) => [r.key, r.label])}
          value={range}
          onChange={(key) => {
            setRange(key)
            setCursor(null)
          }}
        />
      </div>

      <p className="mt-1 min-h-[1.25rem] truncate text-xs text-fg-muted">
        {readout.before}
        <span className="font-semibold text-fg">{readout.value}</span>
        {readout.after}
      </p>
      <p className="sr-only" aria-live="polite">
        {viaKeyboard && cursor !== null ? readoutText : ''}
      </p>

      <div className="mt-1 flex items-start">
        {/* Y labels. The invisible copy sizes the gutter to the widest
            label; the visible ones sit at the max/min line heights. */}
        <div className="relative h-36 shrink-0 pr-1.5 text-right text-[11px] tabular-nums text-fg-subtle sm:h-40">
          <div aria-hidden="true" className="invisible h-0 overflow-hidden whitespace-nowrap">
            <div>{fmt(maxP)}</div>
            <div>{fmt(minP)}</div>
          </div>
          {singlePrice ? (
            <span className="absolute right-1.5 -translate-y-1/2 whitespace-nowrap" style={{ top: pct(y(maxP), VB_H) }}>
              {fmt(maxP)}
            </span>
          ) : (
            <>
              <span className="absolute right-1.5 -translate-y-1/2 whitespace-nowrap" style={{ top: pct(y(maxP), VB_H) }}>
                {fmt(maxP)}
              </span>
              <span className="absolute right-1.5 -translate-y-1/2 whitespace-nowrap" style={{ top: pct(y(minP), VB_H) }}>
                {fmt(minP)}
              </span>
            </>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div
            role="group"
            tabIndex={0}
            onPointerDown={handlePointer}
            onPointerMove={handlePointer}
            // A touch "leaves" as soon as the finger lifts, which would wipe
            // the readout the tap just asked for -- on touch it stays until
            // the chart loses focus (tap elsewhere) instead.
            onPointerLeave={(e) => {
              if (e.pointerType !== 'touch') setCursor(null)
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => setCursor(null)}
            aria-label="Price history chart. Use the left and right arrow keys to step through changes."
            className="relative h-36 cursor-crosshair touch-pan-y select-none rounded-sm border-b border-line bg-bg outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-40"
          >
            {gaps.map(([a, b]) => (
              <div
                key={a}
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 text-slate-400/45 dark:text-slate-400/25"
                style={{ left: pct(x(a), VB_W), width: pct(x(b) - x(a), VB_W), backgroundImage: GAP_HATCH }}
              />
            ))}

            <svg
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={summary}
              className="absolute inset-0 h-full w-full overflow-visible"
            >
              {!singlePrice && (
                <g className="stroke-line" strokeWidth="1">
                  <line x1={0} x2={VB_W} y1={y(maxP)} y2={y(maxP)} vectorEffect="non-scaling-stroke" />
                  <line x1={0} x2={VB_W} y1={y(minP)} y2={y(minP)} vectorEffect="non-scaling-stroke" />
                </g>
              )}

              {segments.map((seg) => {
                const x0 = x(seg.t)
                const w = x(seg.t1) - x0
                if (w <= 0 || typeof seg.stock !== 'number') return null
                // Small inset = the surface gap between neighbouring bars.
                const inset = w > 3 ? 0.75 : 0
                if (seg.stock === 0) {
                  const h = SOLD_OUT_BAND * VB_H
                  return (
                    <rect
                      key={seg.t}
                      x={x0 + inset}
                      y={VB_H - h}
                      width={w - inset * 2}
                      height={h}
                      className="fill-red-400/80 dark:fill-red-500/70"
                    />
                  )
                }
                const h = Math.max((seg.stock / maxStock) * stockBandH, 2)
                return (
                  <rect
                    key={seg.t}
                    x={x0 + inset}
                    y={VB_H - h}
                    width={w - inset * 2}
                    height={h}
                    className="fill-brand-200 dark:fill-brand-800/70"
                  />
                )
              })}

              <path
                d={path}
                fill="none"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                className="stroke-accent"
              />
            </svg>

            {/* End dot with a surface-colored ring (HTML so it stays round). */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-bg"
              style={{ left: '100%', top: pct(y(last.price), VB_H) }}
            />

            {cursor !== null && (
              <>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 w-px bg-fg-subtle"
                  style={{ left: pct(x(cursor), VB_W) }}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-bg"
                  style={{ left: pct(x(cursor), VB_W), top: pct(y(cursorSeg.price), VB_H) }}
                />
              </>
            )}
          </div>

          <div className="mt-1 flex justify-between gap-2 text-[11px] tabular-nums text-fg-subtle">
            <span>{formatDate(start)}</span>
            <span>{formatDate(end)}</span>
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-subtle">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="h-0.5 w-3 rounded-full bg-accent" />
          Price
        </span>
        {maxStock > 0 && (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="h-2 w-2 rounded-[1px] bg-brand-200 dark:bg-brand-800/70" />
            Stock
          </span>
        )}
        {hasSoldOut && (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="h-1 w-3 rounded-[1px] bg-red-400 dark:bg-red-500/70" />
            Sold out
          </span>
        )}
        {gaps.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden="true"
              className="h-2 w-3 rounded-[1px] text-slate-400/80 ring-1 ring-slate-300 dark:text-slate-400/50 dark:ring-night-600"
              style={{ backgroundImage: GAP_HATCH }}
            />
            Not observed
          </span>
        )}
        {converted && (
          <span
            title="Historical prices are yuyu-tei's JPY prices converted at today's exchange rate, so the line tracks yuyu-tei's moves rather than currency swings."
            className="basis-full sm:ml-auto sm:basis-auto"
          >
            Converted from JPY at today’s rate
          </span>
        )}
      </div>

      {/* Table-view twin of the chart: every recorded change, newest first. */}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-fg-subtle hover:text-fg">
          All recorded changes ({series.length})
        </summary>
        <ol className="mt-1.5 max-h-48 overflow-y-auto rounded border border-line">
          {[...series].reverse().map(([t, price, stock]) => (
            <li
              key={t}
              className="flex justify-between gap-3 border-b border-line px-2 py-1 tabular-nums last:border-b-0"
            >
              <span className="text-fg-muted">{formatDateTime(t)}</span>
              <span className="text-right">
                <span className="font-semibold text-fg">{fmt(price)}</span>
                <span className="ml-2 text-fg-subtle">{stockInfo(stock).label}</span>
              </span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  )
}

export default memo(PriceHistoryChart)
