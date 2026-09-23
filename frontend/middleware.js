// Vercel Routing Middleware -- runs before every request (page, assets and
// /api/cards alike, and ahead of Vercel's edge cache), so a blocked
// visitor never reaches the site or the Supabase-backed catalog.
//
// Vercel geolocates the client IP and passes the ISO country code in
// x-vercel-ip-country. The header is absent outside Vercel (e.g. local
// `npm run dev`, which doesn't run this file anyway), and an unknown
// country is let through rather than blocked.
//
// Best-effort only: a VPN/proxy exiting outside a blocked country bypasses it.

const BLOCKED_COUNTRIES = new Set(['JP'])

const BLOCKED_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not available in your region</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font-family: system-ui, sans-serif; background: #f8fafc; color: #334155; text-align: center; padding: 16px; }
  @media (prefers-color-scheme: dark) { body { background: #0f172a; color: #e2e8f0; } }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { margin: 0; font-size: .875rem; opacity: .75; }
</style>
</head>
<body>
  <main>
    <h1>Not available in your region</h1>
    <p>This site isn't available in your country.</p>
  </main>
</body>
</html>`

export default function middleware(request) {
  const country = request.headers.get('x-vercel-ip-country')
  if (!country || !BLOCKED_COUNTRIES.has(country.toUpperCase())) return

  return new Response(BLOCKED_PAGE, {
    status: 403,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
