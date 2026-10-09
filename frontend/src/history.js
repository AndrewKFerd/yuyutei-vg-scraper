// Price history + market movers: lazy loaders and the small pure helpers
// the card modal and Movers view share. Both files are written by
// pipeline/record-history.js every run (formats: see the repo's history
// spec) and served by api/history.js / api/movers.js.
//
// All times in these files are integer minutes since the Unix epoch.
//
// History is strictly a nice-to-have: by default every loader here
// resolves `null` on a 404 (the pipeline hasn't recorded a run yet), a
// network error or an unexpected payload, and never rejects -- the rest of
// the page must keep working without it. (The Movers view, which is *about*
// this data, opts into `{ throwOnError: true }` to tell "not published yet"
// apart from "failed to load" and offer a retry.) Nothing here runs on
// initial page load; the first call happens on the first card-modal open
// or Movers visit.
import { clearCachedJson, getCachedJson } from './catalogCache'

export const HISTORY_URL = '/api/history'
export const MOVERS_URL = '/api/movers'
// Small files the pipeline rewrites every run -- much shorter than the
// catalog's daily TTL so a returning visitor sees recent moves.
const TTL_MS = 30 * 60 * 1000

export const MOVER_WINDOWS = ['24h', '7d', '30d']
export const DEFAULT_MOVER_WINDOW = '7d'
const WINDOW_PERIODS = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' }

/** "24 hours" / "7 days" / "30 days", for accessible labels. */
export function windowPeriod(windowKey) {
  return WINDOW_PERIODS[windowKey] || windowKey
}

function isValidHistory(data) {
  return (
    data?.v === 1 &&
    Number.isFinite(data.trackingSince) &&
    Number.isFinite(data.lastRun) &&
    Array.isArray(data.coverage) &&
    typeof data.cards === 'object' &&
    data.cards !== null
  )
}

function isValidMovers(data) {
  return data?.v === 1 && Number.isFinite(data.asOf) && typeof data.windows === 'object' && data.windows !== null
}

// One in-flight/settled promise per file for the whole session, so opening
// ten modals triggers one request (or one cache read), not ten. A thrown
// error (offline, 5xx) is not memoized -- the next call retries -- while a
// clean 404 / payload is, since retrying those can't change the answer
// until the TTL-backed cache would anyway.
function memoizedLoader(url, validate, label) {
  let promise = null
  // Resolves to the data, or null for a 404 / unexpected payload; rejects
  // only on a genuine load failure. Without `throwOnError` that rejection
  // is turned into null too.
  const load = ({ throwOnError = false } = {}) => {
    if (!promise) {
      const current = getCachedJson(url, { ttlMs: TTL_MS, validate, nullOn404: true }).then(({ data }) => {
        if (data === null) return null
        if (validate(data)) return data
        console.warn(`[history] Ignoring ${label}: unexpected shape.`)
        return null
      })
      // Handled branch: logs, and forgets a failed attempt so the next call
      // retries -- but only our own attempt, since a reset() may already
      // have started a newer one.
      current.catch((err) => {
        console.warn(`[history] Couldn't load ${label} (${err.message}).`)
        if (promise === current) promise = null
      })
      promise = current
    }
    return throwOnError ? promise : promise.catch(() => null)
  }
  load.reset = () => {
    promise = null
  }
  return load
}

/** Resolves to the parsed history-public.json, or null if unavailable. */
export const loadHistory = memoizedLoader(HISTORY_URL, isValidHistory, 'price history')

/**
 * Resolves to the parsed movers.json, or null if unavailable. With
 * `{ throwOnError: true }`, rejects on a load failure instead (null then
 * strictly means "not published yet").
 */
export const loadMovers = memoizedLoader(MOVERS_URL, isValidMovers, 'market movers')

/** Drops the cached history/movers (Cache Storage and the in-session memo). */
export async function clearHistoryCache() {
  loadHistory.reset()
  loadMovers.reset()
  await Promise.all([clearCachedJson(HISTORY_URL), clearCachedJson(MOVERS_URL)])
}

// --- series helpers --------------------------------------------------------
// A series is an ascending array of [minute, priceJpy, stock] entries,
// appended only when price or stock changed. stock: number, 0 = sold out,
// null = yuyu-tei's "◯" (in stock, no count).

/**
 * The card's series, or null when the card isn't in the file -- which means
 * its price hasn't changed since tracking began (the pipeline strips
 * baseline-only cards from the public file).
 */
export function getSeries(history, id) {
  const cards = history?.cards
  if (!cards || !Object.hasOwn(cards, id)) return null
  const series = cards[id]
  return Array.isArray(series) && series.length > 0 ? series : null
}

/** The last entry at or before `minute` (the one "in effect" then), or null. */
export function entryAt(series, minute) {
  let found = null
  for (const entry of series) {
    if (entry[0] > minute) break
    found = entry
  }
  return found
}

/** Minute since epoch of an ISO timestamp (e.g. cards.json's generatedAt), or null. */
export function isoToMinute(iso) {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 60000) : null
}

/**
 * The series' latest entry when it was recorded after the catalog snapshot
 * (`catalogMinute`) and disagrees with the card's price or stock, else null.
 * The catalog is cached for up to an hour while history refreshes every 30
 * minutes, so a returning visitor's catalog can predate what history
 * already knows.
 */
export function newerThanCatalog(series, card, catalogMinute) {
  if (!series || catalogMinute === null) return null
  const latest = series[series.length - 1]
  if (latest[0] <= catalogMinute) return null
  return latest[1] !== card.price || latest[2] !== card.stock ? latest : null
}

/** Low/high price, number of price changes and the most recent one ({from, to, at} or null). */
export function summarizeSeries(series) {
  let low = Infinity
  let high = -Infinity
  let changes = 0
  let lastChange = null
  series.forEach(([at, price], i) => {
    if (price < low) low = price
    if (price > high) high = price
    const prev = series[i - 1]
    if (prev && price !== prev[1]) {
      changes++
      lastChange = { from: prev[1], to: price, at }
    }
  })
  return { low, high, changes, lastChange, firstSeen: series[0][0] }
}

// --- dates -----------------------------------------------------------------

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const DATE_YEAR_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const TIME_FMT = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function minuteToDate(minute) {
  return new Date(minute * 60000)
}

/** "Sep 18", or "Sep 18, 2026" with `year`. Local time zone. */
export function formatDate(minute, { year = false } = {}) {
  return (year ? DATE_YEAR_FMT : DATE_FMT).format(minuteToDate(minute))
}

/** "14:30". */
export function formatTime(minute) {
  return TIME_FMT.format(minuteToDate(minute))
}

/** "Sep 18, 14:30". */
export function formatDateTime(minute) {
  return `${formatDate(minute)}, ${formatTime(minute)}`
}

function sameDay(a, b) {
  return minuteToDate(a).toDateString() === minuteToDate(b).toDateString()
}

/** "5m ago" / "3h ago" / "2d ago", relative to now. */
export function timeAgo(minute, nowMs = Date.now()) {
  const mins = Math.max(0, Math.floor(nowMs / 60000) - minute)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 60) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

/** "Sep 18 and Sep 28", or "10:00 and 13:30 on Sep 27" when both fall on the same day. */
export function formatBetween(from, to) {
  if (sameDay(from, to)) return `${formatTime(from)} and ${formatTime(to)} on ${formatDate(to)}`
  return `${formatDate(from)} and ${formatDate(to)}`
}

/** Compact range for tile captions: "Sep 18–28", "Aug 30–Sep 2", or "Sep 27 10:00–13:30". */
export function formatShortRange(from, to) {
  if (sameDay(from, to)) return `${formatDate(to)} ${formatTime(from)}–${formatTime(to)}`
  const a = minuteToDate(from)
  const b = minuteToDate(to)
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return `${formatDate(from)}–${b.getDate()}`
  return `${formatDate(from)}–${formatDate(to)}`
}

// Coverage = the runs that actually observed the catalog, merged into
// [start, end] spans; the stretches between spans are when the pipeline
// wasn't running (PC off), so nothing was seen then.

/**
 * If the run at `at` was the first one after a coverage gap, the gap as
 * [end of the previous span, at] -- whatever that run saw may have happened
 * anywhere in there. Otherwise (the previous run was minutes earlier) null.
 */
export function gapBefore(at, coverage) {
  const i = Array.isArray(coverage) ? coverage.findIndex((span) => span[0] === at) : -1
  return i > 0 ? [coverage[i - 1][1], at] : null
}

/** The coverage gap `minute` falls strictly inside, as [gapStart, gapEnd], or null. */
export function gapContaining(minute, coverage) {
  if (!Array.isArray(coverage)) return null
  for (let i = 1; i < coverage.length; i++) {
    if (minute > coverage[i - 1][1] && minute < coverage[i][0]) return [coverage[i - 1][1], coverage[i][0]]
  }
  return null
}

/**
 * When a change stamped `at` actually happened, honestly: a change is
 * stamped with the first run that saw it, so if that run is the first one
 * after a gap in coverage, all we know is that it changed sometime during
 * the gap -> "between <end of the previous span> and <at>". Otherwise the
 * previous run was minutes earlier -> "on <at>".
 */
export function describeChangeTime(at, coverage) {
  const gap = gapBefore(at, coverage)
  return gap ? `between ${formatBetween(gap[0], gap[1])}` : `on ${formatDate(at)}`
}

/**
 * Short "when" for an event observed at `at`, for tile captions: "3h ago"
 * when the run before it was minutes earlier; the gap as a range
 * ("Sep 18–28") when it was the first run after a gap, since "35m ago"
 * would overstate how precisely we know; a plain "seen Sep 28" when
 * coverage is unknown.
 */
export function describeObservedAt(at, coverage) {
  if (!Array.isArray(coverage)) return `seen ${formatDate(at)}`
  const gap = gapBefore(at, coverage)
  return gap ? formatShortRange(gap[0], gap[1]) : timeAgo(at)
}

// --- percentages -----------------------------------------------------------

/** Percent change from -> to, or null when there's no meaningful base. */
export function pctChange(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null
  return ((to - from) / from) * 100
}

/** Unsigned magnitude for display: "25%", "0.4%", "1,150%". */
export function formatPctMagnitude(pct) {
  const abs = Math.abs(pct)
  return abs < 1 ? `${abs.toFixed(1)}%` : `${Math.round(abs).toLocaleString('en-US')}%`
}

/** Signed: "+25%" / "−67%". */
export function formatPctSigned(pct) {
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : ''
  return `${sign}${formatPctMagnitude(pct)}`
}
