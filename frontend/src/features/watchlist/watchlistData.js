// The watchlist's pure part: the stored shape and its checks, a card's
// current price and stock, and what changed since it was last looked at.
// The hook (useWatchlist.js) keeps the list in localStorage; this file has
// no React or browser APIs, so the tests can import it.
//
// Times are integer minutes since the Unix epoch, as in the price history.
// A change counts as new until the card is marked as seen, which moves its
// `seen` snapshot up to now.

import { MAX_ITEMS, numOrNull, strOrNull } from '../../lib/limits.js'

/** @typedef {import('../../lib/types.js').WatchItem} WatchItem */
/** @typedef {import('../../lib/types.js').PriceState} PriceState */
/** @typedef {import('../../lib/types.js').HistoryEntry} HistoryEntry */

export const MAX_WATCHED = MAX_ITEMS
// Target prices are whole yen; anything past this is a typo.
export const MAX_TARGET = 9_999_999

/**
 * Most notable first: a change of these kinds sorts its card to the top,
 * and the first one is the card's headline.
 */
export const CHANGE_ORDER = ['target', 'restocked', 'down', 'soldOut', 'up']

/** A whole-yen target price from user input or storage, or null for none. */
export function cleanTarget(value) {
  const n = typeof value === 'string' ? Number(value.replace(/[,\s¥￥]/g, '')) : value
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null
  return Math.min(MAX_TARGET, Math.round(n))
}

/** The names a watched card keeps, to show it even once it's gone from the catalog. */
export function snapOf(card) {
  return {
    nameEn: strOrNull(card.nameEn),
    nameJp: strOrNull(card.nameJp),
    setCode: strOrNull(card.setCode),
    rarity: strOrNull(card.rarity),
  }
}

/**
 * The valid watched cards in `entries` (storage is shared with other tabs
 * and could hold anything, so every field is re-checked): drops entries
 * without an id and repeated ids, and stops at MAX_WATCHED.
 * @param {unknown} entries
 * @returns {WatchItem[]}
 */
export function sanitizeWatchlist(entries) {
  if (!Array.isArray(entries)) return []
  const seen = new Set()
  const items = []
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || seen.has(entry.id)) continue
    seen.add(entry.id)
    const s = entry.seen && typeof entry.seen === 'object' ? entry.seen : {}
    const n = entry.snap && typeof entry.snap === 'object' ? entry.snap : {}
    items.push({
      id: entry.id,
      addedAt: numOrNull(entry.addedAt) ?? 0,
      target: cleanTarget(entry.target),
      seen: { price: numOrNull(s.price), stock: numOrNull(s.stock), at: numOrNull(s.at) ?? 0 },
      snap: snapOf(n),
    })
    if (items.length >= MAX_WATCHED) break
  }
  return items
}

/**
 * The card's price and stock now: the history's latest entry when it was
 * recorded after the catalog was built (the catalog is cached for up to an
 * hour, history for 30 minutes), else the catalog's. `asOf` is the newest
 * minute either is known to be good for -- a card with no newer entry
 * stood unchanged through the history's last run.
 * @param {{ price: number | null, stock: number | null }} card
 * @param {HistoryEntry[] | null} series
 * @param {number | null} catalogMinute
 * @param {number} asOf
 * @returns {PriceState}
 */
export function currentState(card, series, catalogMinute, asOf) {
  const latest = series?.[series.length - 1]
  if (latest && (catalogMinute === null || latest[0] > catalogMinute)) {
    return { price: latest[1], stock: latest[2], at: Math.max(latest[0], asOf) }
  }
  return { price: card.price ?? null, stock: card.stock ?? null, at: asOf }
}

const buyableAtOrBelow = (state, target) => state.stock !== 0 && state.price !== null && state.price <= target

/**
 * What differs between `seen` and `now`, in CHANGE_ORDER: 'target' when
 * the card can now be bought at or under the target and couldn't when last
 * seen; 'restocked' / 'soldOut' across the in-stock line (a count going
 * from 3 to 2 isn't news); 'down' / 'up' for the price.
 * @param {PriceState} seen
 * @param {PriceState} now
 * @param {number | null} target
 * @returns {string[]}
 */
export function changesBetween(seen, now, target) {
  const kinds = new Set()
  if (target !== null && buyableAtOrBelow(now, target) && !buyableAtOrBelow(seen, target)) kinds.add('target')
  if (seen.stock === 0 && now.stock !== 0) kinds.add('restocked')
  if (seen.stock !== 0 && now.stock === 0) kinds.add('soldOut')
  if (seen.price !== null && now.price !== null && now.price !== seen.price) kinds.add(now.price < seen.price ? 'down' : 'up')
  return CHANGE_ORDER.filter((kind) => kinds.has(kind))
}

/**
 * The history's events after minute `since`, newest first: each entry that
 * moved the price or crossed the in-stock line, as { at, kind, from, to }
 * (prices for 'down' / 'up'). Catches what comparing two snapshots can't:
 * a card that came back and sold out again while nobody was looking.
 * @param {HistoryEntry[] | null} series
 * @param {number} since
 * @returns {{ at: number, kind: string, from?: number, to?: number }[]}
 */
export function eventsSince(series, since) {
  if (!series) return []
  const events = []
  for (let i = 1; i < series.length; i++) {
    const [at, price, stock] = series[i]
    if (at <= since) continue
    const [, prevPrice, prevStock] = series[i - 1]
    if (prevStock === 0 && stock !== 0) events.push({ at, kind: 'restocked' })
    else if (prevStock !== 0 && stock === 0) events.push({ at, kind: 'soldOut' })
    if (price !== prevPrice) events.push({ at, kind: price < prevPrice ? 'down' : 'up', from: prevPrice, to: price })
  }
  return events.reverse()
}

/**
 * One watched card, as the view shows it: the catalog card (null when it's
 * not listed, or the catalog hasn't loaded), its state now, and what's new
 * since it was last seen.
 * @param {WatchItem} item
 * @param {{ card: object | null, series: HistoryEntry[] | null, catalogMinute: number | null, asOf: number }} ctx
 */
export function watchRow(item, { card, series, catalogMinute, asOf }) {
  if (!card) return { item, card: null, now: null, changes: [], events: [], news: false, targetMet: false }
  const now = currentState(card, series, catalogMinute, asOf)
  const changes = changesBetween(item.seen, now, item.target)
  const events = eventsSince(series, item.seen.at)
  return {
    item,
    card,
    now,
    changes,
    events,
    news: changes.length > 0 || events.length > 0,
    targetMet: item.target !== null && buyableAtOrBelow(now, item.target),
  }
}

// Where a row's newest event or headline change ranks: the latest event
// time, else the snapshot's (a change seen only by comparing snapshots).
const latestAt = (row) => (row.events.length ? row.events[0].at : row.now?.at ?? 0)

/**
 * Cards with news first -- by their headline change (CHANGE_ORDER), then
 * most recent -- then the rest, most recently added first. A card the
 * catalog doesn't have goes last.
 */
export function sortRows(rows) {
  const rank = (row) => {
    if (!row.card) return CHANGE_ORDER.length + 2
    if (!row.news) return CHANGE_ORDER.length + 1
    const kind = row.changes[0] ?? row.events[0]?.kind
    const i = CHANGE_ORDER.indexOf(kind)
    return i < 0 ? CHANGE_ORDER.length : i
  }
  return [...rows].sort((a, b) => {
    const r = rank(a) - rank(b)
    if (r !== 0) return r
    if (a.news && b.news) return latestAt(b) - latestAt(a)
    return b.item.addedAt - a.item.addedAt
  })
}
