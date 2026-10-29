// Vercel Function (file-system dynamic route: /api/deltas/<stamp>) -- serves
// one price/stock delta (deltas/<stamp>.json, written by
// pipeline/build-delta.js) from the private bucket. A delta never changes once
// written, so it is cached for good. The stamp is validated against a strict
// pattern before anything reaches S3, and _supabaseCards.js re-checks the key.
import { createProxyHandler } from '../_proxyObject.js'
import { deltaKeyForStamp } from '../_supabaseCards.js'

function stampFromRequest(req) {
  let stamp = req.query?.ts
  if (Array.isArray(stamp)) stamp = stamp[0]
  if (stamp === undefined) {
    // Exactly /api/deltas/<stamp>: a deeper path is not this route.
    const segments = (req.url || '').split('?')[0].split('/').filter(Boolean)
    stamp = segments.length === 3 && segments[1] === 'deltas' ? decodeURIComponent(segments[2]) : ''
  }
  return stamp
}

export default createProxyHandler((req) => {
  try {
    return deltaKeyForStamp(stampFromRequest(req))
  } catch {
    return null // malformed percent-encoding in the URL
  }
}, {
  cacheControl: 'public, max-age=31536000, s-maxage=31536000, immutable',
  errorMessage: 'Failed to load update',
  // A delta the pipeline is about to upload (or already pruned) must not stay "missing".
  notFoundCacheControl: 'public, max-age=0, s-maxage=15',
})
