// The set filter's options: [{ slug, code, name }] -- the official product
// code ("D-BT08"), yuyu-tei's name for the set ("女神再臨"; null when unknown)
// and the slug the cards carry. The catalog ships this list in the shop's
// order, newest first (pipeline/catalog-split.js buildSetList); a catalog
// from before that gets the same shape here, with codes read off the cards'
// own "D-BT08/SNR01" codes, sorted by slug.

/** "D-BT08 · 女神再臨", "D-BT08" or "PR/001–PR/100" -- whatever is known. */
export function setLabel(set) {
  if (!set) return ''
  if (set.code && set.name) return `${set.code} · ${set.name}`
  return set.code || set.name || set.slug
}

/** Short form for chips and headings: the code, else the name, else the slug. */
export function setShortLabel(set) {
  if (!set) return ''
  return set.code || set.name || set.slug
}

/** Sets present in `cards`, from the catalog's list when it has one. */
export function buildSetOptions(cards, catalogSets) {
  const present = new Set()
  for (const card of cards) if (card.setSlug) present.add(card.setSlug)

  if (Array.isArray(catalogSets) && catalogSets.length > 0) {
    const listed = catalogSets.filter((set) => set && present.has(set.slug))
    const known = new Set(listed.map((set) => set.slug))
    const rest = [...present].filter((slug) => !known.has(slug)).sort()
    return [...listed, ...rest.map((slug) => ({ slug, code: null, name: null }))]
  }

  // Most common "D-BT08" prefix per set (a set can hold a few reprints).
  const counts = new Map()
  for (const card of cards) {
    if (!card.setSlug) continue
    const prefix = String(card.setCode || '').split('/')[0].trim()
    if (!prefix) continue
    if (!counts.has(card.setSlug)) counts.set(card.setSlug, new Map())
    const bySet = counts.get(card.setSlug)
    bySet.set(prefix, (bySet.get(prefix) || 0) + 1)
  }
  return [...present].sort().map((slug) => {
    let code = null
    let best = 0
    for (const [prefix, n] of counts.get(slug) || []) {
      if (n > best) [code, best] = [prefix, n]
    }
    return { slug, code, name: null }
  })
}
