// Builds a Vercel Function handler that proxies one object from the private
// Supabase bucket, so the browser never sees the S3 credentials. Cached at
// the edge (s-maxage) so repeat visits across different users don't each
// re-hit Supabase. Shared by api/cards.js, api/history.js and api/movers.js.
import { pipeline } from 'node:stream/promises'
import { fetchObjectStream } from './_supabaseCards.js'

// history-public.json / movers.json only exist once the pipeline has
// recorded its first run -- a plain "not there yet", which the client
// handles quietly, as opposed to a genuine upstream failure (502). Only a
// missing *object* counts: other 404s (NoSuchBucket, a wrong endpoint)
// are misconfiguration and must surface as errors, not as "no data yet".
function isMissingObject(err) {
  return err?.name === 'NoSuchKey'
}

function sendJson(res, statusCode, body, cacheControl = 'no-store') {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // Errors are never edge-cached (the next request should retry) -- except
  // a deliberately short-lived 404, see notFoundCacheControl below.
  res.setHeader('Cache-Control', cacheControl)
  res.end(JSON.stringify(body))
}

/**
 * @param {string|((req) => string|null)} keyOrResolver bucket object key (must be
 *   allowlisted in _supabaseCards.js), or a function deriving it from the
 *   request (api/details/[set].js) that returns null for a request that names
 *   no valid object -- answered 400 without any S3 call
 * @param {{cacheControl: string, errorMessage?: string, notFoundCacheControl?: string}} options
 *   notFoundCacheControl: Cache-Control for a 404 (default no-store). A route
 *   open to arbitrary slugs sets a short s-maxage so made-up ones don't each
 *   cost an S3 GET; 400s and 502s stay no-store.
 */
export function createProxyHandler(
  keyOrResolver,
  { cacheControl, errorMessage = 'Failed to load data', notFoundCacheControl = 'no-store' }
) {
  const dynamic = typeof keyOrResolver === 'function'

  return async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405
      res.setHeader('Allow', 'GET, HEAD')
      res.end()
      return
    }

    const key = dynamic ? keyOrResolver(req) : keyOrResolver
    if (!key) {
      sendJson(res, 400, { error: 'Bad request' })
      return
    }

    // The actual key, so a missing shard is identifiable in the logs.
    const logTag = `[api ${key}]`
    let body
    try {
      body = await fetchObjectStream(key)
    } catch (err) {
      if (isMissingObject(err)) {
        // One line, so a key that stays missing is visible in the logs.
        console.warn(`${logTag} Object not found in bucket (404).`)
        sendJson(res, 404, { error: 'Not found' }, notFoundCacheControl)
        return
      }
      // Log the real cause server-side only -- S3 errors can name the
      // endpoint/bucket/key, which the public response has no need to reveal.
      console.error(`${logTag} Failed to fetch object:`, err)
      sendJson(res, 502, { error: errorMessage })
      return
    }

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', cacheControl)
    if (req.method === 'HEAD') {
      body.destroy()
      res.end()
      return
    }
    // pipeline() (unlike .pipe()) tears both streams down if either side
    // errors -- a mid-transfer S3 failure or a client disconnect would
    // otherwise leave the S3 socket open.
    try {
      await pipeline(body, res)
    } catch (err) {
      console.error(`${logTag} Stream aborted:`, err.message)
    }
  }
}
