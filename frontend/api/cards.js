// Vercel Function -- proxies the private Supabase bucket so the browser
// never sees the S3 credentials. Cached at the edge (s-maxage) so repeat
// visits across different users don't each re-hit Supabase.
import { fetchCardsStream } from './_supabaseCards.js'

export default async function handler(req, res) {
  try {
    const body = await fetchCardsStream()
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
    body.pipe(res)
  } catch (err) {
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Failed to load card catalog', message: err.message }))
  }
}
