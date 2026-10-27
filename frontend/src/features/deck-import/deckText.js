// Reading what someone pasted into the deck importer: a Deck Log link or
// deck code, or a decklist as text, one card per line ("4 D-BT01/001
// Blaster Blade", "Blaster Blade x4", "4 ブラスター・ブレード"...). No React
// or browser APIs here, so the tests can import it.

const DECKLOG_HOST = 'decklog.bushiroad.com'
const DECKLOG_EN_HOST = 'decklog-en.bushiroad.com'
// Deck Log's deck codes: a few letters and digits ("A7G1").
export const DECK_CODE_RE = /^[0-9A-Z]{3,8}$/
export const MAX_DECK_LINES = 200
// Pastes and lines are cut to these before any matching: no decklist comes
// close, and it keeps every pattern below working on short input.
export const MAX_INPUT_LENGTH = 30_000
export const MAX_LINE_LENGTH = 300
const MAX_QTY = 99

// A printed card number: an optional era prefix ("D-", "DZ-", "V-", "G-"),
// the set ("BT01", "SS10", "PR"), a slash, then the number with any letter
// prefix/suffix ("001", "SP01", "FFR01", "001EN", "004PR").
const CARD_CODE_RE = /(?:^|[\s([【「])((?:[A-Z]{1,3}-)?[A-Z]{1,6}\d{0,3}[A-Z]?\/[A-Z]{0,5}\d{1,4}[A-Z]{0,4})(?=$|[\s)\]】」,.:;])/i

/**
 * @typedef {object} DeckLine
 * @property {number} qty
 * @property {string | null} code  Upper-case card number, as written.
 * @property {string | null} name
 * @property {string | null} [rarity]
 * @property {string} raw  The line as pasted (for "couldn't match").
 */

/** The deck code in a Deck Log link, or null if `url` isn't one. */
function decklogCode(url) {
  if (url.hostname !== DECKLOG_HOST) return null
  const segment = url.pathname.split('/').filter(Boolean).pop() || ''
  return DECK_CODE_RE.test(segment.toUpperCase()) ? segment.toUpperCase() : null
}

function asUrl(text) {
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
}

// "4 Foo", "4x Foo", "4 x Foo", "x4 Foo", "4枚 Foo" -> [4, "Foo"]. An x
// that starts a word ("4 Xiphos") is the name's, not a times sign.
const LEADING_QTY_RES = [
  /^(\d{1,2})\s*(?:[x×*](?![a-z])|枚)\s*(\S.*)$/i,
  /^(\d{1,2})\s+(\S.*)$/,
  /^[x×*]\s*(\d{1,2})\s+(\S.*)$/i,
]

// "Foo (x4)", "Foo x4", "Foo ×4", "Foo 4枚" -> [4, "Foo"], matched at the
// end of the line only (the name is whatever comes before). A plain x
// only after a space, so "Max4" stays a name.
const TRAILING_QTY_RES = [/[(（]\s*(?:[x×]\s*)?(\d{1,2})\s*[)）]$/i, /(?:\s[x×*]|[×*])\s*(\d{1,2})$/i, /(\d{1,2})\s*枚$/]

function leadingQty(line) {
  for (const re of LEADING_QTY_RES) {
    const m = line.match(re)
    if (m) return [Number(m[1]), m[2]]
  }
  return null
}

function trailingQty(line) {
  for (const re of TRAILING_QTY_RES) {
    const m = line.match(re)
    if (m && m.index > 0) return [Number(m[1]), line.slice(0, m.index)]
  }
  return null
}

// "D-BT01/001 4": a bare count at the end, only read next to a card number.
function bareTrailingQty(line) {
  const m = line.match(/(?:^|\s)(\d{1,2})$/)
  return m ? [Number(m[1]), line.slice(0, m.index)] : null
}

const isSeparator = (ch) => /[\s\-–—:|,.·•*]/.test(ch)

// What's left of a line once its count and card number are out: the name,
// without the brackets and separators that held the number.
function cleanName(text) {
  const name = text.replace(/[([【「]\s*[)\]】」]/g, ' ').replace(/\s+/g, ' ')
  let start = 0
  let end = name.length
  while (start < end && isSeparator(name[start])) start++
  while (end > start && isSeparator(name[end - 1])) end--
  return name.slice(start, end) || null
}

/**
 * One decklist line, or null for one that names no card: blank, a comment
 * ("# ..."), or a heading -- anything with neither a count nor a card
 * number ("Main Deck", "Triggers (16)" has a count but is caught by
 * matching instead).
 * @param {string} rawLine
 * @returns {DeckLine | null}
 */
export function parseDeckLine(rawLine) {
  const raw = rawLine.slice(0, MAX_LINE_LENGTH).trim()
  // NFKC folds full-width letters, digits and slashes ("Ｄ－ＢＴ０１／００１").
  let line = raw.normalize('NFKC').replace(/[‐‑–—−](?=[A-Z]*\d*\/)/gi, '-').trim()
  if (!line || /^(#|\/\/)/.test(line)) return null
  let qty = null
  const lead = leadingQty(line)
  if (lead) [qty, line] = lead
  const codeMatch = line.match(CARD_CODE_RE)
  const code = codeMatch ? codeMatch[1].toUpperCase() : null
  if (code) line = line.replace(codeMatch[1], ' ').trim()
  const trail = qty === null && (trailingQty(line) || (code && bareTrailingQty(line)))
  if (trail) [qty, line] = trail
  if (qty === null && !code) return null
  if (qty !== null && (qty < 1 || qty > MAX_QTY)) return null
  return { qty: qty ?? 1, code, name: cleanName(line), raw }
}

// A Deck Log link or deck code pasted on its own: { kind: 'decklog', code },
// { kind: 'decklog-en' }, or null when `text` is neither.
function readDecklogRef(text) {
  if (/\s/.test(text)) return null
  if (/^(https?:\/\/)?[^/]*bushiroad\.com\//i.test(text)) {
    const url = asUrl(text)
    if (url?.hostname === DECKLOG_EN_HOST) return { kind: 'decklog-en' }
    const code = url && decklogCode(url)
    if (code) return { kind: 'decklog', code }
  }
  const code = text.toUpperCase()
  return DECK_CODE_RE.test(code) && !/^\d{1,2}$/.test(code) ? { kind: 'decklog', code } : null
}

/**
 * What was pasted: { kind: 'decklog', code } for a Deck Log link or bare
 * deck code, { kind: 'decklog-en' } for an English Deck Log link (not
 * supported), { kind: 'text', lines, skipped } for a decklist, or
 * { kind: 'empty' }.
 * @param {string} input
 */
export function readDeckInput(input) {
  const text = (input || '').slice(0, MAX_INPUT_LENGTH).trim()
  if (!text) return { kind: 'empty' }
  const ref = readDecklogRef(text)
  if (ref) return ref
  const lines = []
  const skipped = []
  for (const raw of text.split(/\r?\n/)) {
    if (lines.length >= MAX_DECK_LINES) break
    const line = parseDeckLine(raw)
    if (line) lines.push(line)
    else if (raw.trim()) skipped.push(raw.trim().slice(0, MAX_LINE_LENGTH))
  }
  return { kind: 'text', lines, skipped }
}
