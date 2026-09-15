// Client-side cache for the full card catalog (~10MB — too big for
// localStorage's ~5-10MB quota, so this uses the browser's Cache Storage
// API instead, which is backed by disk and sized for exactly this kind of
// payload). A tiny localStorage entry tracks *when* it was cached.
//
// Behavior: the first visit fetches from the network and caches the raw
// response. Any visit within CACHE_TTL_MS of that reuses the cached copy
// with no network request at all. Once a day has passed, the next visit
// fetches fresh again and re-caches — so as long as `cards.json` on the
// server is itself regenerated roughly daily (pipeline/build-data.js),
// the app's card/price data effectively refreshes once a day per visitor.

const CACHE_NAME = 'yuyutei-catalog-v1'
const CACHE_URL = '/data/cards.json'
const TIMESTAMP_KEY = 'yuyutei:catalogCachedAt'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 1 day

function cacheApiAvailable() {
  return typeof window !== 'undefined' && 'caches' in window
}

function getCachedAt() {
  try {
    const raw = localStorage.getItem(TIMESTAMP_KEY)
    return raw ? Number(raw) : null
  } catch {
    return null
  }
}

function setCachedAt(timestamp) {
  try {
    localStorage.setItem(TIMESTAMP_KEY, String(timestamp))
  } catch {
    // Storage disabled/full — fine, we just won't remember across visits.
  }
}

function isFresh(cachedAt) {
  return typeof cachedAt === 'number' && Date.now() - cachedAt < CACHE_TTL_MS
}

/** The cached copy's JSON if one exists and is still within the daily TTL, else null. */
async function readFromCache() {
  if (!cacheApiAvailable() || !isFresh(getCachedAt())) return null

  try {
    const cache = await caches.open(CACHE_NAME)
    const response = await cache.match(CACHE_URL)
    if (!response) return null
    return await response.json()
  } catch {
    // A corrupt/unreadable cache entry shouldn't break the page — just
    // fall through to a fresh network fetch below.
    return null
  }
}

/** Fetches fresh from the network and (best-effort) caches the response. */
async function fetchAndCache() {
  const response = await fetch(CACHE_URL)
  if (!response.ok) {
    throw new Error(`Failed to load the card catalog (HTTP ${response.status}).`)
  }

  if (cacheApiAvailable()) {
    try {
      const cache = await caches.open(CACHE_NAME)
      await cache.put(CACHE_URL, response.clone())
      setCachedAt(Date.now())
    } catch {
      // Caching failed (quota, private browsing, etc.) — not fatal, the
      // page still works, it'll just fetch fresh again next visit too.
    }
  }

  return response.json()
}

/**
 * Resolves to `{ data, fromCache }` — `data` from a same-day local cache
 * when one exists, otherwise from the network (which also refreshes the
 * cache for next time), with `fromCache` saying which happened. Only a
 * genuine network/HTTP failure on that fallback fetch ever rejects; every
 * cache-related failure degrades silently to a normal fetch instead.
 */
export async function getCachedCatalog() {
  const cached = await readFromCache()
  if (cached) return { data: cached, fromCache: true }
  return { data: await fetchAndCache(), fromCache: false }
}

/** Drops the cached copy and its timestamp, so the next load re-fetches. */
export async function clearCatalogCache() {
  try {
    if (cacheApiAvailable()) {
      const cache = await caches.open(CACHE_NAME)
      await cache.delete(CACHE_URL)
    }
    localStorage.removeItem(TIMESTAMP_KEY)
  } catch {
    // ignore — worst case the stale cache just lingers until it expires naturally
  }
}
