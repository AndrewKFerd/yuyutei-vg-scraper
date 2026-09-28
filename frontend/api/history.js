// Vercel Function -- serves history-public.json (per-listing price/stock
// change history, written by pipeline/record-history.js) from the private
// bucket. Shorter edge cache than the catalog: the pipeline refreshes it
// every run, and it's small. The private canonical price-history.json is
// never servable (see the allowlist in _supabaseCards.js).
import { createProxyHandler } from './_proxyObject.js'

export default createProxyHandler('history-public.json', {
  cacheControl: 'public, max-age=0, s-maxage=900, stale-while-revalidate=3600',
  errorMessage: 'Failed to load price history',
})
