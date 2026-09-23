// Vercel Function -- proxies the private Supabase bucket so the browser
// never sees the S3 credentials. Cached at the edge (s-maxage) so repeat
// visits across different users don't each re-hit Supabase.
import { pipeline } from 'node:stream/promises'
import { fetchCardsStream } from './_supabaseCards.js'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.setHeader('Allow', 'GET, HEAD')
    res.end()
    return
  }

  let body
  try {
    body = await fetchCardsStream()
  } catch (err) {
    // Log the real cause server-side only -- S3 errors can name the
    // endpoint/bucket/key, which the public response has no need to reveal.
    console.error('[api/cards] Failed to fetch catalog:', err)
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify({ error: 'Failed to load card catalog' }))
    return
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
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
    console.error('[api/cards] Stream aborted:', err.message)
  }
}
