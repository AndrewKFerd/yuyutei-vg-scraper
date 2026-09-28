// Client-side cache for the JSON the site downloads: the full card catalog
// (~30 MB — far too big for localStorage's ~5-10 MB quota), plus the much
// smaller price history and market movers files. All of them go in the
// browser's Cache Storage API, which is backed by disk and sized for
// exactly this kind of payload. A tiny localStorage entry per URL tracks
// *when* each was cached.
//
// Behavior: the first visit fetches from the network and caches the raw
// response. Any visit within that URL's TTL reuses the cached copy with no
// network request at all. Once the TTL has passed, the next visit fetches
// fresh again and re-caches. The catalog uses a 1-day TTL (the heavy
// download, and prices only need to be roughly daily-fresh for browsing);
// history/movers use 30 minutes, since they're small and the pipeline
// rewrites them every run.

const CACHE_NAME = 'yuyutei-catalog-v1'
// Proxied through our own /api/* functions (api/cards.js etc.) rather than
// static files -- the dataset lives in a private Supabase Storage bucket,
// and those endpoints are the only thing allowed to read it (they hold the
// S3 credentials server-side, never sent to the browser).
export const CATALOG_URL = '/api/cards'
// The catalog keeps the timestamp key it had before this cache was
// generalized, so deploying the change doesn't invalidate every visitor's
// cached copy and force a fresh ~30 MB download.
const CATALOG_TIMESTAMP_KEY = 'yuyutei:catalogCachedAt'
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000 // 1 day

function cacheApiAvailable() {
  return typeof window !== 'undefined' && 'caches' in window
}

function timestampKey(url) {
  return url === CATALOG_URL ? CATALOG_TIMESTAMP_KEY : `yuyutei:cachedAt:${url}`
}

function getCachedAt(url) {
  try {
    const raw = localStorage.getItem(timestampKey(url))
    return raw ? Number(raw) : null
  } catch {
    return null
  }
}

function setCachedAt(url, timestamp) {
  try {
    localStorage.setItem(timestampKey(url), String(timestamp))
  } catch {
    // Storage disabled/full — fine, we just won't remember across visits.
  }
}

function isFresh(cachedAt, ttlMs) {
  return typeof cachedAt === 'number' && Date.now() - cachedAt < ttlMs
}

/** The cached copy's JSON if one exists, is within the TTL and passes `validate`, else null. */
async function readFromCache(url, ttlMs, validate) {
  if (!cacheApiAvailable() || !isFresh(getCachedAt(url), ttlMs)) return null

  try {
    const cache = await caches.open(CACHE_NAME)
    const response = await cache.match(url)
    if (!response) return null
    const data = await response.json()
    // An invalid cached copy (e.g. an empty catalog cached by an older
    // build) counts as a miss, so it gets replaced instead of pinning a
    // broken page for the rest of the TTL.
    return validate(data) ? data : null
  } catch {
    // A corrupt/unreadable cache entry shouldn't break the page — just
    // fall through to a fresh network fetch below.
    return null
  }
}

/** Fetches fresh from the network and (best-effort) caches the response if it's valid. */
async function fetchAndCache(url, validate, nullOn404) {
  const response = await fetch(url)
  if (nullOn404 && response.status === 404) return null
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  // Parse one branch and keep the other to store, so only a response that
  // actually validates gets cached.
  const copy = cacheApiAvailable() ? response.clone() : null
  const data = await response.json()

  if (copy && validate(data)) {
    try {
      const cache = await caches.open(CACHE_NAME)
      await cache.put(url, copy)
      setCachedAt(url, Date.now())
    } catch {
      // Caching failed (quota, private browsing, etc.) — not fatal, the
      // page still works, it'll just fetch fresh again next visit too.
    }
  }

  return data
}

/**
 * Resolves to `{ data, fromCache }` — `data` from a local cache younger
 * than `ttlMs` when one exists (and passes `validate`), otherwise from the
 * network (which also refreshes the cache for next time, if the response
 * passes `validate`), with `fromCache` saying which happened. Network data
 * that fails `validate` is still returned, just never cached — the caller
 * decides what an invalid payload means. With `nullOn404`, an HTTP 404
 * resolves `data: null` (not cached). Only a genuine network/HTTP failure
 * on the fallback fetch ever rejects; every cache-related failure degrades
 * silently to a normal fetch instead.
 */
export async function getCachedJson(url, { ttlMs, validate = () => true, nullOn404 = false }) {
  const cached = await readFromCache(url, ttlMs, validate)
  if (cached) return { data: cached, fromCache: true }
  return { data: await fetchAndCache(url, validate, nullOn404), fromCache: false }
}

/** Drops one URL's cached copy and its timestamp, so the next load re-fetches. */
export async function clearCachedJson(url) {
  try {
    if (cacheApiAvailable()) {
      const cache = await caches.open(CACHE_NAME)
      await cache.delete(url)
    }
    localStorage.removeItem(timestampKey(url))
  } catch {
    // ignore — worst case the stale cache just lingers until it expires naturally
  }
}

// Never cache (and never trust a cached copy of) a catalog with no cards —
// a truncated upload would otherwise stick for a whole day.
function isValidCatalog(data) {
  return Boolean(data) && Array.isArray(data.cards) && data.cards.length > 0
}

/**
 * The catalog, via the same-day cache. Resolves to `{ data, fromCache }`;
 * rejects only on a network/HTTP failure (see getCachedJson).
 */
export function getCachedCatalog() {
  return getCachedJson(CATALOG_URL, { ttlMs: CATALOG_TTL_MS, validate: isValidCatalog })
}

/** Drops the cached catalog and its timestamp, so the next load re-fetches. */
export function clearCatalogCache() {
  return clearCachedJson(CATALOG_URL)
}
