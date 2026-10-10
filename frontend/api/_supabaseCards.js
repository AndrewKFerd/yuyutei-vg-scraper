// Shared by the api/*.js proxy routes (Vercel Functions, production) and
// vite.config.js's dev middleware (local `npm run dev`) -- one code path
// either way, so local testing actually exercises the same S3 call
// production makes.
//
// The bucket is deliberately private (not "public" storage) -- this is the
// only server-side path allowed to read it. Credentials live in
// SUPABASE_S3_* env vars (Vercel project settings in prod, .env.local
// locally) and are never sent to the browser.
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

// The bucket also holds objects that must never be public -- above all
// price-history.json, the private canonical history the pipeline keeps as
// a backup, and cards.json, the full ~30 MB build kept for the pipeline's
// gates (too big to edge-cache, so serving it let anyone run up egress).
// Only these keys are servable; anything else is refused before
// any request reaches S3, so a future route (or a bug that lets a caller
// influence the key) can't turn this into a read-anything proxy.
const SERVABLE_KEYS = new Set(['catalog.json', 'history-public.json', 'movers.json'])

// Per-set detail shards (details/<setSlug>.json). Set slugs are lowercase
// letters, digits and hyphens (dzbt14, vpromo-300). The pattern is strict
// on purpose -- no dots, slashes or uppercase -- so the key can never walk
// out of details/ or name another object.
const DETAIL_SLUG_RE = /^[a-z0-9-]+$/
const DETAIL_KEY_RE = /^details\/[a-z0-9-]+\.json$/

/** The bucket key for a set's detail shard, or null if `slug` isn't a plausible set slug. */
export function detailKeyForSlug(slug) {
  return typeof slug === 'string' && slug.length <= 64 && DETAIL_SLUG_RE.test(slug)
    ? `details/${slug}.json`
    : null
}

let client = null

function getClient() {
  if (client) return client
  client = new S3Client({
    endpoint: process.env.SUPABASE_S3_ENDPOINT,
    region: process.env.SUPABASE_S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.SUPABASE_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.SUPABASE_S3_SECRET_ACCESS_KEY,
    },
  })
  return client
}

/** Resolves to the readable body stream of an allowlisted bucket object. */
export async function fetchObjectStream(key) {
  if (!SERVABLE_KEYS.has(key) && !(typeof key === 'string' && key.length <= 80 && DETAIL_KEY_RE.test(key))) {
    throw new Error(`Refusing to read non-servable object key "${key}"`)
  }
  const result = await getClient().send(new GetObjectCommand({
    Bucket: process.env.SUPABASE_S3_BUCKET,
    Key: key,
  }))
  return result.Body
}
