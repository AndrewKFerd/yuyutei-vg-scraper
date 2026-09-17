// Three stock states come out of the pipeline (see parseStock in
// pipeline/scrape-catalog.js): a specific count, 0 (confirmed out of
// stock), or null -- yuyu-tei's "◯" marker for bulk/always-available
// items (commons, trial-deck fillers) with no specific count shown.
export function stockInfo(stock) {
  if (stock === null) return { inStock: true, label: 'In stock' }
  if (stock > 0) return { inStock: true, label: `Stock: ${stock}` }
  return { inStock: false, label: 'Out of stock' }
}
