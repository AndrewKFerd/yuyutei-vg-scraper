// Date, time and percentage formatting shared across the site. Times are
// integer minutes since the Unix epoch, as in the price history files.

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const DATE_YEAR_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const TIME_FMT = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** Minute since epoch of an ISO timestamp (e.g. cards.json's generatedAt), or null. */
export function isoToMinute(iso) {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 60000) : null
}

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

/** "1 card" / "1,200 cards". */
export function plural(n, one, many) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

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
