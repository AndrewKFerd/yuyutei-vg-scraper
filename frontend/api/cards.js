// Vercel Function -- serves the card catalog (cards.json) from the private
// Supabase bucket. See _proxyObject.js for the shared proxy behavior.
import { createProxyHandler } from './_proxyObject.js'

export default createProxyHandler('cards.json', {
  cacheControl: 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
  errorMessage: 'Failed to load card catalog',
})
