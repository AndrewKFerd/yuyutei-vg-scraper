import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Serves /api/cards during `vite dev` by calling the exact same handler
// api/cards.js exports for production, so local dev exercises the real
// Supabase-backed path instead of needing a static cards.json fallback.
function supabaseCardsDevMiddleware(env) {
  return {
    name: 'supabase-cards-dev-middleware',
    configureServer(server) {
      Object.assign(process.env, env)
      server.middlewares.use('/api/cards', async (req, res) => {
        const { default: handler } = await import('./api/cards.js')
        await handler(req, res)
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
