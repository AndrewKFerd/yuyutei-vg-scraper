// Card names the translator can resolve inside 「」: every catalog card's
// Japanese name -> its English one. Several listings share a Japanese name
// (reprints), and their English names can come from different sources, so
// the most trustworthy source wins. Foil/signed variants carry a marker on
// both names ("…(箔押し)" / "… (Foil Stamping)"), which rules text never
// quotes, so they're skipped.

const SOURCE_RANK = { official: 0, fandom: 1, glossary: 2 }
const JAPANESE = /[぀-ヿ㐀-鿿]/
const VARIANT_MARKER = /[(（](箔押し|サイン入り|シリアルナンバー付き|[^()（）]*仕様)[)）]\s*$/

/** Map of Japanese card name -> English card name. */
export function buildNameIndex(cards) {
  const best = new Map()
  for (const card of cards || []) {
    const jp = card.nameJp?.trim()
    const en = card.nameEn?.trim()
    if (!jp || !en || JAPANESE.test(en) || VARIANT_MARKER.test(jp)) continue
    const rank = SOURCE_RANK[card.translationSource] ?? 3
    const held = best.get(jp)
    if (!held || rank < held.rank) best.set(jp, { en, rank })
  }
  const names = new Map()
  for (const [jp, { en }] of best) names.set(jp, en)
  return names
}
