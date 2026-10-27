// A small JSON response for the Vercel Functions (api/*.js): errors, and
// payloads built in the function rather than streamed from the bucket.
// Errors default to no-store, so the next request retries.
export function sendJson(res, statusCode, body, cacheControl = 'no-store') {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', cacheControl)
  res.end(JSON.stringify(body))
}
