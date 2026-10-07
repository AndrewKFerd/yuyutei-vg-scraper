// The inverse of pipeline/catalog-split.js's slimCard(): the slim catalog
// (/api/catalog) omits imageUrl, detailUrl and priceDisplay whenever they
// follow from the card's id / price, and keeps them explicitly when they
// don't (a "noimage" placeholder, a null). This fills the omitted ones back
// in, once after load, so the grid, modal and Movers view keep reading
// card.imageUrl / detailUrl / priceDisplay as before.
//
// Pure (no browser APIs) so the pipeline's tests can round-trip it against
// slimCard(). Keep the three derivations identical to catalog-split.js.

export const derivedImageUrl = (id) => `https://card.yuyu-tei.jp/vg/100_140/${id}.jpg`
export const derivedDetailUrl = (id) => `https://yuyu-tei.jp/sell/vg/card/${id}`
export const derivedPriceDisplay = (price) =>
  Number.isFinite(price) ? `¥${price.toLocaleString('en-US')}` : null

/**
 * Fills in the omitted derived fields on every card, in place (the array is
 * a freshly parsed response, and copying 28k objects would just be churn).
 * `=== undefined` rather than a falsy check: an explicit null in the data
 * means "this card has no such URL" and must stay null.
 */
export function hydrateCards(cards) {
  for (const card of cards) {
    if (card.imageUrl === undefined) card.imageUrl = derivedImageUrl(card.id)
    if (card.detailUrl === undefined) card.detailUrl = derivedDetailUrl(card.id)
    if (card.priceDisplay === undefined) card.priceDisplay = derivedPriceDisplay(card.price)
  }
  return cards
}
