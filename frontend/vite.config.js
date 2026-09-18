import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Serves /api/cards during `vite dev` the same way api/cards.js does in
// production, so local dev exercises the real Supabase-backed path instead
// of needing a static frontend/public/data/cards.json fallback.
function supabaseCardsDevMiddleware(env) {
  return {
    name: 'supabase-cards-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api/cards', async (req, res) => {
        Object.assign(process.env, env)
        const { fetchCardsStream } = await import('./api/_supabaseCards.js')
        try {
          const body = await fetchCardsStream()
          res.setHeader('Content-Type', 'application/json')
          body.pipe(res)
        } catch (err) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Failed to load card catalog', message: err.message }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Empty 3rd arg means "no VITE_ prefix filter" -- SUPABASE_S3_* vars stay
  // server-side (this function, and api/cards.js in prod), never bundled
  // into client code.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), supabaseCardsDevMiddleware(env)],
  }
})
