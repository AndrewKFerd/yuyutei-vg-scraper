// Vercel Function -- serves movers.json (precomputed 24h/7d/30d market
// movers, written by pipeline/record-history.js) from the private bucket.
import { createProxyHandler } from './_proxyObject.js'

export default createProxyHandler('movers.json', {
  cacheControl: 'public, max-age=0, s-maxage=900, stale-while-revalidate=3600',
  errorMessage: 'Failed to load market movers',
})
