// Turning a decklist into yuyu-tei listings: each line is matched by card
// number (else by name) to a printing, and the copies are then taken from
// that printing ("exact") or from the cheapest printings in stock of the
// same card ("cheapest"). No React or browser APIs here, so the tests can
// import it.
//
// "The same card" follows pipeline/card-group.js: same era (the set code's
// prefix, "D", "V", "G"...; original-era sets have none) and the same
// Japanese name without yuyu-tei's variant markers ("(箔押し)"...), and
// here also without spaces, which differ between printings. Unlike there,
// DZ counts as D: they're one format, and DZ sets reprint D cards.

/** @typedef {import('../../lib/types.js').Card} Card */
/** @typedef {import('./deckText.js').DeckLine} DeckLine */

// Newest era first: a name shared across eras ("Blaster Blade" is a V and a
// D card) matches the newest one's printings.
const ERA_ORDER = ['D', 'V', 'G', 'legacy']
// Another printing stands in for the listed one only while it costs at most
// this many times the listed one (or this much more), so a missing ¥30
// common doesn't turn into a ¥9,800 signed copy.
const SUBSTITUTE_FACTOR = 3
const SUBSTITUTE_FLOOR_JPY = 300

// One trailing "(...)" group; baseName strips them one at a time.
const LAST_GROUP_RE = /[(（][^()（）]*[)）]$/

/** The Japanese name without its trailing variant markers ("(箔押し)", "(RRR仕様)"...). */
function baseName(nameJp) {
  let name = (nameJp || '').trim()
  for (let m = name.match(LAST_GROUP_RE); m; m = name.match(LAST_GROUP_RE)) name = name.slice(0, m.index).trimEnd()
  return name
}

function era(setCode) {
  const m = (setCode || '').split('/')[0].match(/^([A-Za-z]+)-/)
  if (!m) return 'legacy'
  const prefix = m[1].toUpperCase()
  return prefix === 'DZ' ? 'D' : prefix
}

/** "The same card" key for a listing. */
export function printingGroup(card) {
  return `${era(card.setCode)}|${baseName(card.nameJp).replace(/\s+/g, '')}`
}

/** A name folded for matching: width, case, spaces and dots don't count. */
export function foldName(name) {
  return (name || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s・·.,'’"“”!?！？\-‐–—]/g, '')
}

const eraRank = (key) => {
  const i = ERA_ORDER.indexOf(key.slice(0, key.indexOf('|')))
  return i < 0 ? ERA_ORDER.length : i
}

/**
 * Lookups over the catalog: by card number, by printing group, and by
 * folded English or Japanese name (to groups, newest era first).
 * @param {Card[]} cards
 */
export function buildDeckIndex(cards) {
  const byCode = new Map()
  const byGroup = new Map()
  const byName = new Map()
  const push = (map, key, value) => {
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }
  for (const card of cards) {
    if (card.setCode) push(byCode, card.setCode.toUpperCase(), card)
    const group = printingGroup(card)
    push(byGroup, group, card)
    for (const name of [card.nameEn, baseName(card.nameJp)]) {
      const folded = foldName(name)
      if (!folded) continue
      const groups = byName.get(folded)
      if (!groups) byName.set(folded, [group])
      else if (!groups.includes(group)) groups.push(group)
    }
  }
  for (const groups of byName.values()) groups.sort((a, b) => eraRank(a) - eraRank(b))
  return { byCode, byGroup, byName }
}

const inStock = (card) => card.stock !== 0 && card.price !== null
// Cheapest first; sold-out and unpriced printings after the rest.
function byBuyability(a, b) {
  if (inStock(a) !== inStock(b)) return inStock(a) ? -1 : 1
  return (a.price ?? Infinity) - (b.price ?? Infinity)
}
const isPlain = (card) => baseName(card.nameJp) === (card.nameJp || '').trim()

// Of the listings sharing a card number (yuyu-tei lists foil and non-foil
// separately), the one the decklist means: its rarity if given, then the
// plain printing, then whichever is in stock and cheapest.
function pickListing(listings, rarity) {
  const pool = rarity ? listings.filter((card) => card.rarity === rarity) : []
  return [...(pool.length ? pool : listings)].sort((a, b) => {
    if (isPlain(a) !== isPlain(b)) return isPlain(a) ? -1 : 1
    return byBuyability(a, b)
  })[0]
}

// "D-BT01/001EN" (an English printing's number) -> the Japanese one.
function lookupCode(index, code) {
  return index.byCode.get(code) || (code.endsWith('EN') ? index.byCode.get(code.slice(0, -2)) : null) || null
}

/**
 * Which listing a line names, and every printing of that card (cheapest in
 * stock first), or null when it matches nothing. `via` says how: 'code' or
 * 'name'.
 * @param {DeckLine} line
 * @param {ReturnType<typeof buildDeckIndex>} index
 * @returns {{ listed: Card, printings: Card[], via: 'code' | 'name' } | null}
 */
export function resolveLine(line, index) {
  let listed = null
  let via = /** @type {'code' | 'name'} */ ('code')
  if (line.code) {
    const listings = lookupCode(index, line.code)
    if (listings) listed = pickListing(listings, line.rarity)
  }
  if (!listed && line.name) {
    const groups = index.byName.get(foldName(line.name))
    if (groups) {
      listed = pickListing(index.byGroup.get(groups[0]), line.rarity)
      via = 'name'
    }
  }
  if (!listed) return null
  const printings = [...(index.byGroup.get(printingGroup(listed)) || [listed])].sort(byBuyability)
  return { listed, printings, via }
}

/**
 * Where a line's copies come from. `choice` is a listing id the user picked
 * for this line, or null to follow `mode`: 'exact' takes them all from the
 * listed printing; 'cheapest' fills from the cheapest printings in stock
 * (each up to its stock count; null stock = no limit) within the
 * substitute cap, and puts any copies still missing on the listed printing.
 * `used` (listing id -> copies earlier lines already took) is updated, so
 * two lines can't both count on the same copies.
 * Returns { take: [{ card, qty }], short } where `short` is how many
 * copies aren't in stock.
 * @param {number} qty
 * @param {{ listed: Card, printings: Card[] }} match
 * @param {'exact' | 'cheapest'} mode
 * @param {string | null} [choice]
 * @param {Map<string, number>} [used]
 */
export function allocate(qty, match, mode, choice = null, used = new Map()) {
  const left = (card) => (card.stock === null ? Infinity : Math.max(0, card.stock - (used.get(card.id) || 0)))
  const done = (take) => {
    let short = 0
    for (const { card, qty: n } of take) {
      short += Math.max(0, n - left(card))
      used.set(card.id, (used.get(card.id) || 0) + n)
    }
    return { take, short }
  }
  const chosen = choice ? match.printings.find((card) => card.id === choice) : null
  if (chosen) return done([{ card: chosen, qty }])
  if (mode === 'exact') return done([{ card: match.listed, qty }])

  const cap = match.listed.price === null ? Infinity : Math.max(match.listed.price * SUBSTITUTE_FACTOR, match.listed.price + SUBSTITUTE_FLOOR_JPY)
  const take = []
  let need = qty
  for (const card of match.printings) {
    if (need === 0) break
    if (card.price === null || left(card) === 0 || (card.id !== match.listed.id && card.price > cap)) continue
    const n = Math.min(need, left(card))
    take.push({ card, qty: n })
    need -= n
  }
  if (need > 0) {
    const listed = take.find((t) => t.card.id === match.listed.id)
    if (listed) listed.qty += need
    else take.push({ card: match.listed, qty: need })
  }
  return done(take)
}

/**
 * The whole deck: one row per line ({ line, match, take, short }, match
 * null when unmatched) and the totals -- cards to add (merged by listing),
 * copies, the JPY total, and copies not in stock.
 * @param {DeckLine[]} lines
 * @param {ReturnType<typeof buildDeckIndex>} index
 * @param {'exact' | 'cheapest'} mode
 * @param {Record<number, string>} [choices]  line index -> listing id
 */
export function planDeck(lines, index, mode, choices = {}) {
  const used = new Map()
  const rows = lines.map((line, i) => {
    const match = resolveLine(line, index)
    if (!match) return { line, match: null, take: [], short: 0 }
    return { line, match, ...allocate(line.qty, match, mode, choices[i] ?? null, used) }
  })
  const merged = new Map()
  let copies = 0
  let totalJpy = 0
  let short = 0
  let unpriced = 0
  for (const row of rows) {
    short += row.short
    for (const { card, qty } of row.take) {
      copies += qty
      if (card.price === null) unpriced += qty
      else totalJpy += card.price * qty
      const entry = merged.get(card.id)
      if (entry) entry.qty += qty
      else merged.set(card.id, { card, qty })
    }
  }
  return {
    rows,
    entries: [...merged.values()],
    copies,
    totalJpy,
    short,
    unpriced,
    matched: rows.filter((row) => row.match).length,
  }
}

/**
 * For each line that's short, the listing the missing copies sit on (the
 * one asked for more copies than it has), for watching its restock.
 */
export function shortCards(plan) {
  const seen = new Map()
  for (const row of plan.rows) {
    if (row.short === 0) continue
    const over = row.take.find(({ card }) => card.stock !== null) || row.take[0]
    seen.set(over.card.id, over.card)
  }
  return [...seen.values()]
}
