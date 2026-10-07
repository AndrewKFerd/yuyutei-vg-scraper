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

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // Never let the edge cache an error -- the next request should retry.
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

/**
 * @param {string|((req) => string|null)} keyOrResolver bucket object key (must be
 *   allowlisted in _supabaseCards.js), or a function deriving it from the
 *   request (api/details/[set].js) that returns null for a request that names
 *   no valid object -- answered 400 without any S3 call
 * @param {{cacheControl: string, errorMessage?: string}} options
 */
export function createProxyHandler(keyOrResolver, { cacheControl, errorMessage = 'Failed to load data' }) {
  const dynamic = typeof keyOrResolver === 'function'
  const logTag = `[api ${dynamic ? 'dynamic' : keyOrResolver}]`

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

    let body
    try {
      body = await fetchObjectStream(key)
    } catch (err) {
      if (isMissingObject(err)) {
        // One line, so a key that stays missing is visible in the logs.
        console.warn(`${logTag} Object not found in bucket (404).`)
        sendJson(res, 404, { error: 'Not found' })
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
