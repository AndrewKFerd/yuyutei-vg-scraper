// Vercel Function -- serves meta.json (the live-update manifest: when the
// catalog was generated, its structure hash and the chain of price/stock
// deltas, written by pipeline/upload-cards.js) from the private bucket.
// Clients poll it, so its edge cache is short; everything it points at
// (catalog, deltas) is fetched under a version-specific URL.
import { createProxyHandler } from './_proxyObject.js'

export default createProxyHandler('meta.json', {
  cacheControl: 'public, max-age=0, s-maxage=15, stale-while-revalidate=60',
  errorMessage: 'Failed to load update info',
})
