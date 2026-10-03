import { getCachedCatalog } from './catalogCache'
import { clearHistoryCache } from './history'

/**
 * Fetches the full pre-generated card catalog — every set, tens of
 * thousands of rows — via `/api/cards`, a same-origin Vercel Function that
 * proxies a private Supabase Storage bucket (see api/cards.js). The
 * dataset itself is still built entirely offline (pipeline/build-data.js);
 * this just downloads and parses it once on load.
 *
 * The first visit in a day downloads it fresh; any repeat visit within the
 * same day reuses a local cached copy instead of re-downloading a ~30 MB
 * file every time (see catalogCache.js). The resolved object's `fromCache`
 * flag says which one happened. `force` skips the cached copy (see
 * refreshCatalog).
 *
 * @returns {Promise<{generatedAt: string, count: number, cards: Array, fromCache: boolean}>}
 */
export async function fetchCatalog({ force = false } = {}) {
  let data, fromCache
  try {
    ;({ data, fromCache } = await getCachedCatalog({ force }))
  } catch (err) {
    throw new Error(`Could not load the card catalog. (${err.message})`)
  }

  if (!data || !Array.isArray(data.cards)) {
    throw new Error('Card catalog response has an unexpected shape.')
  }
  return { ...data, fromCache }
}

/**
 * Re-fetches the catalog from the network, bypassing the daily cache, and
 * only once that succeeds replaces the cached copy and drops the price
 * history / market movers caches (so they can't disagree with the fresh
 * catalog; they reload lazily when next needed). A failure -- offline, a
 * 5xx, or an empty catalog -- rejects and leaves every cache as it was, so
 * the page can keep showing what it already has.
 */
export async function refreshCatalog() {
  const result = await fetchCatalog({ force: true })
  if (result.cards.length === 0) throw new Error('The server returned an empty card catalog.')
  await clearHistoryCache()
  return result
}
