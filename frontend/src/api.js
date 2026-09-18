import { clearCatalogCache, getCachedCatalog } from './catalogCache'

/**
 * Fetches the full pre-generated card catalog — every set, tens of
 * thousands of rows — via `/api/cards`, a same-origin Vercel Function that
 * proxies a private Supabase Storage bucket (see api/cards.js). The
 * dataset itself is still built entirely offline (pipeline/build-data.js);
 * this just downloads and parses it once on load.
 *
 * The first visit in a day downloads it fresh; any repeat visit within the
 * same day reuses a local cached copy instead of re-downloading a ~10MB
 * file every time (see catalogCache.js). The resolved object's `fromCache`
 * flag says which one happened.
 *
 * @returns {Promise<{generatedAt: string, count: number, cards: Array, fromCache: boolean}>}
 */
export async function fetchCatalog() {
  let data, fromCache
  try {
    ;({ data, fromCache } = await getCachedCatalog())
  } catch (err) {
    throw new Error(`Could not load the card catalog. (${err.message})`)
  }

  if (!data || !Array.isArray(data.cards)) {
    throw new Error('Card catalog response has an unexpected shape.')
  }
  return { ...data, fromCache }
}

/** Drops the cached catalog and re-fetches fresh from the network. */
export async function refreshCatalog() {
  await clearCatalogCache()
  return fetchCatalog()
}
