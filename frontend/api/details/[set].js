// Vercel Function (file-system dynamic route: /api/details/<setSlug>) --
// serves one set's detail shard (details/<setSlug>.json: skill text, flavor,
// stat line per card) from the private Supabase bucket. The card modal
// fetches it when a card of that set is opened. See _proxyObject.js for the
// shared proxy behavior.
//
// The slug is validated against a strict pattern before anything reaches S3
// (a bad one is a 400 with no upstream call), and _supabaseCards.js
// re-checks the resulting key against its allowlist.
import { createProxyHandler } from '../_proxyObject.js'
import { detailKeyForSlug } from '../_supabaseCards.js'

// Vercel puts the dynamic segment in req.query.set; the vite dev middleware
// does the same. The URL fallback keeps this working if a runtime doesn't.
function slugFromRequest(req) {
  let slug = req.query?.set
  if (Array.isArray(slug)) slug = slug[0]
  if (slug === undefined) {
    const pathname = (req.url || '').split('?')[0]
    slug = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '')
  }
  return slug
}

export default createProxyHandler((req) => {
  try {
    return detailKeyForSlug(slugFromRequest(req))
  } catch {
    return null // malformed percent-encoding in the URL
  }
}, {
  // Shards change only when a set's text does, but they ship alongside the
  // catalog, so they share its edge cache lifetime.
  cacheControl: 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
  errorMessage: 'Failed to load card details',
})
