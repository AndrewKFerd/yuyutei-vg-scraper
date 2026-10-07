import { memo, useEffect, useMemo, useState } from 'react'
import CardTile from './CardTile'
import CurrencySelector from './CurrencySelector'
import { formatPrice } from '../currency'
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
// cached for up to a day while movers/history refresh every 30 minutes, so
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
  risers: { title: 'Biggest risers', icon: '▲', iconClass: 'text-green-600 dark:text-green-400' },
  drops: { title: 'Biggest drops', icon: '▼', iconClass: 'text-red-600 dark:text-red-400' },
  soldOut: { title: 'Just sold out', icon: '⛔', iconClass: 'text-red-600 dark:text-red-400' },
  restocked: { title: 'Back in stock', icon: '↺', iconClass: 'text-brand-600 dark:text-brand-400' },
  sellingFast: {
    title: 'Selling fast',
    icon: '↯',
    iconClass: 'text-gold-800 dark:text-gold-500',
    description: 'Largest stock drops over the window — listings with a stock count only.',
  },
}

const MoversSection = memo(function MoversSection({ sectionKey, tiles, currency, rates, onSelect }) {
  const [expanded, setExpanded] = useState(false)
  const { title, icon, iconClass, description } = SECTION_META[sectionKey]
  const visible = expanded ? tiles : tiles.slice(0, PREVIEW_COUNT)
  const headingId = `movers-${sectionKey}`

  return (
    <section aria-labelledby={headingId}>
      <div className="px-4 pb-2">
        <h2 id={headingId} className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-gold-500">
          <span aria-hidden="true" className={iconClass}>
            {icon}
          </span>
          {title}
          <span className="text-xs font-normal text-slate-400 dark:text-gold-500/50">
            ({tiles.length.toLocaleString()})
          </span>
        </h2>
        {description && <p className="mt-0.5 text-[11px] text-slate-400 dark:text-gold-500/50">{description}</p>}
      </div>

      {tiles.length === 0 ? (
        <p className="px-4 text-xs italic text-slate-400 dark:text-gold-500/50">No changes in this window.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {visible.map((tile) => (
              <CardTile
                key={tile.card.id}
                card={tile.card}
                currency={currency}
                rates={rates}
                onSelect={onSelect}
                delta={tile.delta}
                caption={tile.caption}
              />
            ))}
          </div>
          {tiles.length > PREVIEW_COUNT && (
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="rounded-full px-3 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50 hover:underline dark:text-brand-400 dark:hover:bg-night-800"
              >
                {expanded ? 'Show fewer' : `Show all (${tiles.length.toLocaleString()})`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
})

const selectClass =
  'w-full rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100 sm:w-auto dark:border-night-600 dark:bg-night-800 dark:text-gold-500 dark:focus:border-brand-500 dark:focus:ring-brand-500/20'

function MoversView({
  cardsById,
  catalogReady,
  dataVersion,
  currency,
  rates,
  onCurrencyChange,
  windowKey,
  onWindowChange,
  minPrice,
  onMinPriceChange,
  nations,
  nation,
  onNationChange,
  onSelect,
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
    <div className="pb-10">
      <div className="mx-auto mt-3 flex max-w-3xl flex-wrap items-center justify-center gap-2 px-4">
        <div
          role="group"
          aria-label="Time window"
          className="flex w-full rounded-full border border-slate-300 bg-white p-1 shadow-sm sm:w-auto dark:border-night-600 dark:bg-night-800"
        >
          {MOVER_WINDOWS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onWindowChange(key)}
              aria-pressed={windowKey === key}
              className={`flex-1 rounded-full px-4 py-1 text-sm font-medium transition sm:flex-none ${
                windowKey === key
                  ? 'bg-brand-600 text-white dark:bg-brand-500 dark:text-night-950'
                  : 'text-slate-600 hover:text-brand-700 dark:text-gold-500/80 dark:hover:text-brand-400'
              }`}
            >
              {key}
            </button>
          ))}
        </div>
        <select
          value={minPrice}
          onChange={(e) => onMinPriceChange(Number(e.target.value))}
          aria-label="Minimum price (in JPY)"
          className={selectClass}
        >
          {MIN_PRICE_OPTIONS.map((value) => (
            <option key={value} value={value}>
              Min price ¥{value.toLocaleString('en-US')}
            </option>
          ))}
        </select>
        {nationGroups.length > 0 && (
          <select
            value={nation}
            onChange={(e) => onNationChange(e.target.value)}
            aria-label="Nation"
            className={selectClass}
          >
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
          </select>
        )}
        <CurrencySelector value={currency} onChange={onCurrencyChange} />
      </div>

      <div className="mx-auto mt-3 max-w-xl px-4 text-center text-xs text-slate-500 dark:text-gold-500/70">
        {loading ? (
          'Loading market movers…'
        ) : failed ? (
          <p>
            Couldn’t load market data.{' '}
            <button
              type="button"
              onClick={retry}
              className="font-semibold text-brand-600 underline-offset-2 hover:underline dark:text-brand-400"
            >
              Retry
            </button>
          </p>
        ) : movers === null || !win ? (
          'Market data isn’t available yet — check back after the next refresh.'
        ) : (
          <>
            <p>
              Price and stock moves over the last {windowPeriod(windowKey)} · updated{' '}
              <span title={formatDateTime(movers.asOf)}>{timeAgo(movers.asOf)}</span>
            </p>
            {win.complete === false && (
              <p className="mt-1 text-gold-800 dark:text-gold-500">
                {history
                  ? `History only goes back to ${formatDate(history.trackingSince, { year: true })}, so this window is partial.`
                  : 'History doesn’t cover this whole window yet, so it is partial.'}
              </p>
            )}
            {sinceGap && (
              <p className="mt-1 text-gold-800 dark:text-gold-500">
                No observations between {formatBetween(sinceGap[0], sinceGap[1])}, so some of these changes may be
                older than {windowPeriod(windowKey)}.
              </p>
            )}
          </>
        )}
      </div>

      {loading && (
        <div className="mt-6 grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[100/140] w-full animate-pulse rounded-md bg-slate-200 dark:bg-night-700" />
          ))}
        </div>
      )}

      {sections && (
        <div className="mt-6 flex flex-col gap-8">
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
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default MoversView
