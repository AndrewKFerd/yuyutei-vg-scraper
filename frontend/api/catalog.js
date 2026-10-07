// Vercel Function -- serves the slim card catalog (catalog.json: what the
// grid, search and Market Movers need, ~0.6 MB compressed) from the private
// Supabase bucket. The heavy per-card text lives in api/details/[set].js.
// See _proxyObject.js for the shared proxy behavior.
import { createProxyHandler } from './_proxyObject.js'

export default createProxyHandler('catalog.json', {
  cacheControl: 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
  errorMessage: 'Failed to load card catalog',
})
