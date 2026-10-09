import { pctChange } from './history'

// The sort dropdown's options, keyed by what sortCards() below understands.
// The 7-day sorts use each card's `chg7d` (baked into the catalog by the
// pipeline), so they work without downloading the price history file.
export const SORT_OPTIONS = [
  // The catalog's own order is yuyu-tei's: top rarities first, newest sets
  // first within each.
  ['default', 'Rarest first'],
  ['price-asc', 'Price: low → high'],
  ['price-desc', 'Price: high → low'],
  ['rise-7d', 'Biggest 7d rise'],
  ['drop-7d', 'Biggest 7d drop'],
]

// Sort step (SortSelect), applied to the filtered list before pagination /
// rarity sections. Array.prototype.sort is stable, so ties -- and every
// card a 7-day sort doesn't rank -- keep the default catalog order.
export function sortCards(cards, sort) {
  if (sort === 'price-asc' || sort === 'price-desc') {
    const dir = sort === 'price-asc' ? 1 : -1
    return [...cards].sort((a, b) => {
      const aMissing = a.price == null
      const bMissing = b.price == null
      // Cards with no price sort last in both directions.
      if (aMissing || bMissing) return aMissing - bMissing
      return (a.price - b.price) * dir
    })
  }
  if (sort === 'rise-7d' || sort === 'drop-7d') {
    // chg7d is only present on listings whose price changed in the last 7
    // days (see pipeline/build-data.js) -- those moving the chosen way come
    // first by size of move, then everything else in default order.
    const wantUp = sort === 'rise-7d'
    const moved = []
    const rest = []
    for (const card of cards) {
      const pct = card.chg7d ? pctChange(card.chg7d.from, card.price) : null
      if (pct !== null && (wantUp ? pct > 0 : pct < 0)) moved.push({ card, pct })
      else rest.push(card)
    }
    moved.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    return [...moved.map((m) => m.card), ...rest]
  }
  return cards
}
