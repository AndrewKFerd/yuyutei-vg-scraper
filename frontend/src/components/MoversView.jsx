import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import CardTile from './CardTile'
import { GridSkeleton } from './CardGrid'
import Icon from './icons'
import { Button, Segmented, Select } from './controls'
import { formatPrice } from '../currency'
import { CONTAINER, GRID } from '../ui'
import {
  MOVER_WINDOWS,
  describeObservedAt,
  formatBetween,
  formatDate,
  formatDateTime,
  gapContaining,
  getSeries,
  loadHistory,
  loadMovers,
  pctChange,
  timeAgo,
  windowPeriod,
} from '../history'

// Market Movers: leaderboards precomputed by pipeline/record-history.js
// (movers.json), joined here against the catalog that's already loaded.

const PREVIEW_COUNT = 12
// Prices are compared in JPY whatever the display currency, so the floor
// means the same thing for everyone. The default hides bulk commons whose
// ¥30 -> ¥50 moves would otherwise dominate the percentage lists.
const MIN_PRICE_OPTIONS = [0, 300, 500, 1000]
export const DEFAULT_MIN_PRICE = 300

// Representative printing for a collapsed group: an official English name
// beats a wiki fan translation, which beats a romaji/machine one; then the
// shortest Japanese name (the plain printing, without "(箔押し)"-style
// variant markers); then whichever came first.
const SOURCE_RANK = { official: 0, fandom: 1 }
function isBetterRepresentative(a, b) {
  const ra = SOURCE_RANK[a.translationSource] ?? 2
  const rb = SOURCE_RANK[b.translationSource] ?? 2
  if (ra !== rb) return ra < rb
  return (a.nameJp || '').length < (b.nameJp || '').length
}

const yenDisplay = (price) => `¥${price.toLocaleString('en-US')}`

// card.nation is a code ('KS'), an array of codes for a multi-nation card,
// or absent (see pipeline/nation.js). '' = all nations.
function inNation(card, nation) {
  if (!nation) return true
  return Array.isArray(card.nation) ? card.nation.includes(nation) : card.nation === nation
}

// Tiles show the movers-side price/stock, not the catalog's: the catalog is
// cached for up to an hour while movers/history refresh every 30 minutes, so
// a returning visitor's catalog can say "¥500, 1 in stock" for a card this
// view lists as "¥500 -> ¥1,480, just sold out". The same object is what a
// tap passes to the card modal. Returns the catalog object itself when
// nothing differs (and is only called inside useMemo, so identities stay
// stable for CardTile's memo).
function withCurrent(card, price, stock) {
  if (card.price === price && card.stock === stock) return card
  if (price === card.price) return { ...card, stock }
  // chg7d is relative to the catalog's (older) price, so it no longer
  // applies once the price is replaced.
  const rest = { ...card }
  delete rest.chg7d
  return { ...rest, price, priceDisplay: yenDisplay(price), stock }
}

// Current stock for a price-change tile: history's latest entry, if it's
// the entry that set this price (movers.json's price entries carry no stock).
function stockFor(card, price, history) {
  const series = getSeries(history, card.id)
  const latest = series?.[series.length - 1]
  return latest && latest[1] === price ? latest[2] : card.stock
}

function printingsLabel(extra) {
  return extra > 0 ? `+${extra} printing${extra === 1 ? '' : 's'}` : null
}

/**
 * Tiles for one direction of `priceChanges`. Listings of the same card
 * (same groupKey) that moved identically (same from -> to) collapse into one
 * tile -- a reprint wave otherwise fills the list with the same art.
 */
function priceTiles(entries, direction, { cardsById, minPrice, nation, period, currency, rates, history }) {
  const groups = new Map()
  for (const entry of entries) {
    if (direction === 'up' ? entry.to <= entry.from : entry.to >= entry.from) continue
    if (Math.max(entry.from, entry.to) < minPrice) continue
    const card = cardsById.get(entry.id)
    if (!card || !inNation(card, nation)) continue
    const key = `${entry.g}\u0000${entry.from}\u0000${entry.to}`
    const group = groups.get(key)
    if (group) group.members.push(card)
    else groups.set(key, { entry, members: [card] })
  }

  const tiles = []
  for (const { entry, members } of groups.values()) {
    let card = members[0]
    for (const candidate of members.slice(1)) {
      if (isBetterRepresentative(candidate, card)) card = candidate
    }
    tiles.push({
      card: withCurrent(card, entry.to, stockFor(card, entry.to, history)),
      pct: pctChange(entry.from, entry.to) ?? 0,
      // Built once per data/filter change (inside useMemo) so CardTile's
      // memo sees the same object across unrelated re-renders.
      delta: { from: entry.from, to: entry.to, period },
      caption: [printingsLabel(members.length - 1), `was ${formatPrice(entry.from, currency, rates)}`]
        .filter(Boolean)
        .join(' · '),
    })
  }
  // Risers: biggest % first. Drops: most negative first. (Stable sort keeps
  // the file's order for ties.)
  tiles.sort((a, b) => (direction === 'up' ? b.pct - a.pct : a.pct - b.pct))
  return tiles
}

// soldOut / restocked / sellingFast. `stockOf` gives the entry's current
// stock (soldOut entries carry none: it's 0 by definition). No delta chip
// (null): the card's own 7-day chip would be misleading next to a 24h or
// 30d window.
function stockTiles(entries, captionFor, stockOf, { cardsById, minPrice, nation }) {
  const tiles = []
  for (const entry of entries) {
    const card = cardsById.get(entry.id)
    if (!card || !inNation(card, nation)) continue
    const price = entry.price ?? card.price
    if (price < minPrice) continue
    tiles.push({ card: withCurrent(card, price, stockOf(entry, card)), delta: null, caption: captionFor(entry) })
  }
  return tiles
}

const SOLD_OUT = () => 0
const ENTRY_STOCK = (entry, card) => (entry.stock !== undefined ? entry.stock : card.stock)

const SECTION_META = {
  risers: { title: 'Biggest risers', short: 'Risers', icon: 'trendUp', iconClass: 'text-positive' },
  drops: { title: 'Biggest drops', short: 'Drops', icon: 'trendDown', iconClass: 'text-negative' },
  soldOut: { title: 'Just sold out', short: 'Sold out', icon: 'soldOut', iconClass: 'text-negative' },
  restocked: { title: 'Back in stock', short: 'Restocked', icon: 'restock', iconClass: 'text-accent' },
  sellingFast: {
    title: 'Selling fast',
    short: 'Selling fast',
    icon: 'bolt',
    iconClass: 'text-warning',
    description: 'Largest stock drops over the window — listings with a stock count only.',
  },
}

const sectionId = (key) => `movers-${key}`

// In-page links to each list with its size, so the fifth list is one tap
// away instead of four screens of scrolling.
function SectionJumps({ sections }) {
  return (
    <nav aria-label="Jump to list" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {Object.entries(SECTION_META).map(([key, { short, icon, iconClass }]) => (
        <a
          key={key}
          href={`#${sectionId(key)}`}
          onClick={(e) => {
            e.preventDefault()
            document.getElementById(sectionId(key))?.scrollIntoView({
              block: 'start',
              behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
            })
          }}
          className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 text-xs font-medium text-fg shadow-sm transition hover:border-accent hover:text-accent"
        >
          <Icon name={icon} className={`h-4 w-4 ${iconClass}`} />
          {short}
          <span className="tabular-nums text-fg-subtle">{sections[key].length.toLocaleString()}</span>
        </a>
      ))}
    </nav>
  )
}

const MoversSection = memo(function MoversSection({ sectionKey, tiles, currency, rates, onSelect, qtyById, onToggle }) {
  const [expanded, setExpanded] = useState(false)
  const { title, icon, iconClass, description } = SECTION_META[sectionKey]
  const visible = expanded ? tiles : tiles.slice(0, PREVIEW_COUNT)
  const headingId = `${sectionId(sectionKey)}-heading`
  // The modal's previous/next walk this list (all of it, not just the preview).
  const list = useMemo(() => tiles.map((tile) => tile.card), [tiles])
  const select = useCallback((card) => onSelect(card, list), [onSelect, list])

  return (
    <section id={sectionId(sectionKey)} aria-labelledby={headingId} className="scroll-mt-4">
      <div className="pb-2.5">
        <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold text-fg">
          <Icon name={icon} className={`h-5 w-5 ${iconClass}`} />
          {title}
          <span className="text-sm font-normal tabular-nums text-fg-subtle">{tiles.length.toLocaleString()}</span>
        </h2>
        {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </div>

      {tiles.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-fg-subtle">
          No changes in this window.
        </p>
      ) : (
        <>
          <div className={GRID}>
            {visible.map((tile) => (
              <CardTile
                key={tile.card.id}
                card={tile.card}
                currency={currency}
                rates={rates}
                onSelect={select}
                selectedQty={qtyById.get(tile.card.id) || 0}
                onToggle={onToggle}
                delta={tile.delta}
                caption={tile.caption}
              />
            ))}
          </div>
          {tiles.length > PREVIEW_COUNT && (
            <div className="mt-3 text-center">
              <Button size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
                {expanded ? 'Show fewer' : `Show all ${tiles.length.toLocaleString()}`}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
})

function MoversView({
  cardsById,
  catalogReady,
  dataVersion,
  currency,
  rates,
  windowKey,
  onWindowChange,
  minPrice,
  onMinPriceChange,
  nations,
  nation,
  onNationChange,
  onSelect,
  qtyById,
  onToggle,
}) {
  // movers: undefined = loading, null = not published yet (404), else the
  // file. moversError = the load itself failed (offline, 5xx) -> Retry.
  const [movers, setMovers] = useState(undefined)
  const [moversError, setMoversError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [history, setHistory] = useState(undefined)

  // Both load lazily when this view mounts (memoized per session, so
  // switching tabs back and forth doesn't refetch; `dataVersion` changes
  // after a catalog refresh, which also drops their caches).
  useEffect(() => {
    let cancelled = false
    loadMovers({ throwOnError: true }).then(
      (m) => {
        if (cancelled) return
        setMovers(m)
        setMoversError(false)
      },
      () => {
        if (!cancelled) setMoversError(true)
      }
    )
    return () => {
      cancelled = true
    }
  }, [attempt, dataVersion])

  // History isn't required to show the lists -- they render as soon as
  // movers.json is in -- but its coverage spans make event times honest
  // (a change first seen after the PC was off for days didn't happen "35m
  // ago"), and it supplies trackingSince and fresher stock for price tiles.
  // Loading it here also makes the first tile tap's chart instant.
  useEffect(() => {
    let cancelled = false
    loadHistory().then((h) => {
      if (!cancelled) setHistory(h)
    })
    return () => {
      cancelled = true
    }
  }, [dataVersion])

  const retry = () => {
    setMoversError(false)
    setAttempt((n) => n + 1)
  }

  const win = movers?.windows?.[windowKey] ?? null
  const coverage = history?.coverage

  const sections = useMemo(() => {
    if (!win || !catalogReady) return null
    const ctx = { cardsById, minPrice, nation, period: windowPeriod(windowKey), currency, rates, history }
    const priceChanges = Array.isArray(win.priceChanges) ? win.priceChanges : []
    const list = (key) => (Array.isArray(win[key]) ? win[key] : [])
    // Until history arrives, coverage is undefined and times read "seen
    // <date>"; they sharpen to "3h ago" / "Sep 18–28" once it's in.
    const cov = history?.coverage
    return {
      risers: priceTiles(priceChanges, 'up', ctx),
      drops: priceTiles(priceChanges, 'down', ctx),
      soldOut: stockTiles(list('soldOut'), (e) => `Sold out · ${describeObservedAt(e.at, cov)}`, SOLD_OUT, ctx),
      restocked: stockTiles(list('restocked'), (e) => `Restocked · ${describeObservedAt(e.at, cov)}`, ENTRY_STOCK, ctx),
      sellingFast: stockTiles(list('sellingFast'), (e) => `Sold ${e.sold}`, ENTRY_STOCK, ctx),
    }
  }, [win, catalogReady, cardsById, minPrice, nation, windowKey, currency, rates, history])

  // The catalog's nation list, narrowed to nations some card actually
  // carries and grouped for the dropdown's <optgroup>s, in list order.
  const nationGroups = useMemo(() => {
    const present = new Set()
    for (const card of cardsById.values()) {
      for (const code of [card.nation].flat()) if (code) present.add(code)
    }
    const groups = new Map()
    for (const n of nations) {
      if (!present.has(n.code)) continue
      if (!groups.has(n.group)) groups.set(n.group, [])
      groups.get(n.group).push(n)
    }
    return [...groups]
  }, [nations, cardsById])

  // If the window starts inside a stretch with no observations, the first
  // run after it may have caught changes from before the window began --
  // e.g. after a 10-day gap, "24h" holds everything since the gap started.
  const sinceGap = win ? gapContaining(win.since, coverage) : null

  const failed = moversError && movers === undefined
  const loading = !catalogReady || (movers === undefined && !failed)

  return (
    <div className={`${CONTAINER} pb-10 pt-5`}>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Time window"
          options={MOVER_WINDOWS.map((key) => [key, key])}
          value={windowKey}
          onChange={onWindowChange}
          className="w-full sm:w-auto"
        />
        <Select
          value={minPrice}
          onChange={(value) => onMinPriceChange(Number(value))}
          label="Minimum price (in JPY)"
          className="flex-1 sm:flex-none"
        >
          {MIN_PRICE_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value === 0 ? 'Any price' : `¥${value.toLocaleString('en-US')} and up`}
            </option>
          ))}
        </Select>
        {nationGroups.length > 0 && (
          <Select value={nation} onChange={onNationChange} label="Nation" className="flex-1 sm:flex-none">
            <option value="">All nations</option>
            {nationGroups.map(([group, list]) => (
              <optgroup key={group} label={group}>
                {list.map((n) => (
                  <option key={n.code} value={n.code}>
                    {n.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        )}
      </div>

      <div className="pt-4 text-sm text-fg-muted">
        {loading ? (
          'Loading market movers…'
        ) : failed ? (
          <p role="alert" className="flex flex-wrap items-center gap-x-2">
            Couldn’t load market data.
            <Button variant="link" size="inline" onClick={retry}>
              Try again
            </Button>
          </p>
        ) : movers === null || !win ? (
          'Market data isn’t available yet — check back after the next refresh.'
        ) : (
          <>
            <p>
              Price and stock moves over the last {windowPeriod(windowKey)} · updated{' '}
              <span title={formatDateTime(movers.asOf)}>{timeAgo(movers.asOf)}</span>
            </p>
            {(win.complete === false || sinceGap) && (
              <p className="mt-2 flex items-start gap-2 rounded-lg border border-highlight-line bg-highlight px-3 py-2 text-xs text-fg">
                <Icon name="info" className="mt-px h-4 w-4 text-warning" />
                <span>
                  {win.complete === false &&
                    (history
                      ? `History only goes back to ${formatDate(history.trackingSince, { year: true })}, so this window is partial. `
                      : 'History doesn’t cover this whole window yet, so it is partial. ')}
                  {sinceGap &&
                    `No observations between ${formatBetween(sinceGap[0], sinceGap[1])}, so some of these changes may be older than ${windowPeriod(windowKey)}.`}
                </span>
              </p>
            )}
          </>
        )}
      </div>

      {loading && <GridSkeleton count={8} className="mt-6" />}

      {sections && (
        <>
          <div className="pt-4">
            <SectionJumps sections={sections} />
          </div>
          <div className="mt-6 flex flex-col gap-10">
            {Object.keys(SECTION_META).map((key) => (
              <MoversSection
                // Keyed on the filters too, so "Show all" collapses again
                // when the window, price floor or nation changes.
                key={`${key}-${windowKey}-${minPrice}-${nation}`}
                sectionKey={key}
                tiles={sections[key]}
                currency={currency}
                rates={rates}
                onSelect={onSelect}
                qtyById={qtyById}
                onToggle={onToggle}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default MoversView
