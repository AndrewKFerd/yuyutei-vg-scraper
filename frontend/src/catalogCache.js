// Client-side cache for the JSON the site downloads: the slim card catalog
// (~6 MB — over localStorage's ~5-10 MB quota in practice), the per-set
// detail shards, and the price history and market movers files. All go in the
// browser's Cache Storage API, which is backed by disk and sized for
// exactly this kind of payload. A tiny localStorage entry per URL tracks
// *when* each was cached.
//
// Behavior: the first visit fetches from the network and caches the raw
// response. Any visit within that URL's TTL reuses the cached copy with no
// network request at all. Once the TTL has passed, the next visit fetches
// fresh again and re-caches. The catalog uses a 1-hour TTL (the heavy
// download, matching the edge cache in api/catalog.js, so a new set or a
// price change shows up within about an hour);
// history/movers use 30 minutes, since they're small and the pipeline
// rewrites them every run.

const CACHE_NAME = 'yuyutei-catalog-v1'
// Proxied through our own /api/* functions (api/cards.js etc.) rather than
// static files -- the dataset lives in a private Supabase Storage bucket,
// and those endpoints are the only thing allowed to read it (they hold the
// S3 credentials server-side, never sent to the browser).
export const CATALOG_URL = '/api/catalog'
const CATALOG_TTL_MS = 60 * 60 * 1000 // 1 hour
// The catalog used to be the full ~30 MB /api/cards file, cached under this
// URL with its own timestamp key. The slim catalog has a new URL (so a stale
// full copy can never be read as a slim one) and the default timestamp key;
// the old entry is dropped once, see dropLegacyCatalogCache.
const LEGACY_CATALOG_URL = '/api/cards'
const LEGACY_TIMESTAMP_KEY = 'yuyutei:catalogCachedAt'
// Per-set detail shards (the card modal's skill text etc.) live under this
// path, one cached entry per set; see details.js.
export const DETAILS_URL_PREFIX = '/api/details/'

function cacheApiAvailable() {
  return typeof window !== 'undefined' && 'caches' in window
}

function timestampKey(url) {
  return `yuyutei:cachedAt:${url}`
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
 * resolves `data: null` (not cached). With `force`, the cache isn't read at
 * all -- the network copy replaces it only once it has arrived and
 * validated, so a failed forced fetch leaves the cached copy intact. Only a
 * genuine network/HTTP failure on the fetch ever rejects; every
 * cache-related failure degrades silently to a normal fetch instead.
 */
export async function getCachedJson(url, { ttlMs, validate = () => true, nullOn404 = false, force = false }) {
  const cached = force ? null : await readFromCache(url, ttlMs, validate)
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

/**
 * Drops every cached URL under `pathPrefix` (and its timestamp), e.g. all
 * the per-set detail shards. Cache Storage can be listed, localStorage
 * entries are matched by their key.
 */
export async function clearCachedJsonByPrefix(pathPrefix) {
  try {
    if (cacheApiAvailable()) {
      const cache = await caches.open(CACHE_NAME)
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname.startsWith(pathPrefix)) await cache.delete(request)
      }
    }
    const stampPrefix = timestampKey(pathPrefix)
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(stampPrefix)) localStorage.removeItem(key)
    }
  } catch {
    // ignore — stale entries just expire on their own TTL
  }
}

/**
 * One-time cleanup of the pre-split full catalog: its ~30 MB Cache Storage
 * entry and timestamp would otherwise sit in the visitor's disk quota
 * forever, since nothing reads them any more.
 */
export async function dropLegacyCatalogCache() {
  try {
    if (cacheApiAvailable()) {
      const cache = await caches.open(CACHE_NAME)
      await cache.delete(LEGACY_CATALOG_URL)
    }
    localStorage.removeItem(LEGACY_TIMESTAMP_KEY)
  } catch {
    // ignore
  }
}

// Never cache (and never trust a cached copy of) a catalog with no cards —
// a truncated upload would otherwise stick until the cache expires.
// The slim catalog's format version (pipeline/catalog-split.js writes v: 1):
// anything else -- the old full file, a future format this build can't read --
// is invalid, so it's neither cached nor trusted.
export const CATALOG_FORMAT_VERSION = 1

// A catalog without the `nations` list predates the Market Movers nation
// filter. It still loads, but counts as invalid so it's never cached and a
// cached one is re-fetched -- otherwise a returning visitor would go a whole
// day without the filter.
function isValidCatalog(data) {
  return (
    Boolean(data) &&
    data.v === CATALOG_FORMAT_VERSION &&
    Array.isArray(data.cards) &&
    data.cards.length > 0 &&
    Array.isArray(data.nations)
  )
}

/**
 * The catalog, via the hourly cache (bypassed for reading with `force`).
 * Resolves to `{ data, fromCache }`; rejects only on a network/HTTP failure
 * (see getCachedJson).
 */
export function getCachedCatalog({ force = false } = {}) {
  return getCachedJson(CATALOG_URL, { ttlMs: CATALOG_TTL_MS, validate: isValidCatalog, force })
}
