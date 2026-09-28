import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Route -> [production handler module, bucket object / local file name].
const API_ROUTES = {
  '/api/cards': ['./api/cards.js', 'cards.json'],
  '/api/history': ['./api/history.js', 'history-public.json'],
  '/api/movers': ['./api/movers.js', 'movers.json'],
}

// Dev-only stand-in for the bucket: streams the same three files from a
// local directory (e.g. LOCAL_DATA_DIR=../pipeline/data), so the site can
// be run and tested without Supabase credentials. Mirrors the production
// handler's status codes (405 / 404 JSON) so the client paths match.
async function serveLocalFile(req, res, filePath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.setHeader('Allow', 'GET, HEAD')
    res.end()
    return
  }
  try {
    if (!(await stat(filePath)).isFile()) throw new Error('not a file')
  } catch {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify({ error: 'Not found' }))
    return
  }
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  try {
    await pipeline(createReadStream(filePath), res)
  } catch (err) {
    console.error(`[local-data] Stream aborted for ${filePath}:`, err.message)
  }
}

// Serves /api/cards, /api/history and /api/movers during `vite dev` by
// calling the exact same handlers api/*.js export for production, so local
// dev exercises the real Supabase-backed path -- unless LOCAL_DATA_DIR is
// set, in which case they're served from files in that directory instead.
function apiDevMiddleware(env) {
  return {
    name: 'api-dev-middleware',
    configureServer(server) {
      Object.assign(process.env, env)
      const localDir = env.LOCAL_DATA_DIR ? path.resolve(env.LOCAL_DATA_DIR) : null
      if (localDir) {
        server.config.logger.info(`  [api] Serving /api/* from LOCAL_DATA_DIR: ${localDir}`)
      }
      for (const [route, [modulePath, fileName]] of Object.entries(API_ROUTES)) {
        server.middlewares.use(route, async (req, res) => {
          if (localDir) {
            await serveLocalFile(req, res, path.join(localDir, fileName))
            return
          }
          // Absolute URL resolved against this file, so the import works the
          // same from Vite's temporary bundled copy of the config.
          const { default: handler } = await import(new URL(modulePath, import.meta.url).href)
          await handler(req, res)
        })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Empty 3rd arg means "no VITE_ prefix filter" -- SUPABASE_S3_* vars stay
  // server-side (this function, and api/*.js in prod), never bundled into
  // client code. It also picks up LOCAL_DATA_DIR from the shell or .env.local.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), apiDevMiddleware(env)],
  }
})
