import { clearCatalogCache, getCachedCatalog } from './catalogCache'

/**
 * Fetches the full pre-generated card catalog — every set, tens of
 * thousands of rows — as a static JSON asset served same-origin from
 * `public/data/cards.json` (Vite dev server and any static host in
 * production both serve `public/` at the site root). There's no backend
 * call here anymore: the dataset is built offline and just needs to be
 * downloaded and parsed once on load.
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
