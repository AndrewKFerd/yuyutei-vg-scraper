import { CATALOG_FORMAT_VERSION, dropLegacyCatalogCache, getCachedCatalog } from './catalogCache'
import { hydrateCards } from '../lib/catalogFormat'
import { clearDetailsCache } from './details'
import { clearHistoryCache } from './history'
import { fetchMeta } from './deltas'

/**
 * Fetches the pre-generated card catalog — every set, tens of thousands of
 * rows, slimmed to what the grid/search needs — via `/api/catalog`, a
 * same-origin Vercel Function that proxies a private Supabase Storage bucket
 * (see api/catalog.js). The heavy per-card text (skill, flavor, stats) is
 * not in it: the card modal loads that per set (see details.js). The dataset
 * itself is still built entirely offline (pipeline/build-data.js); this just
 * downloads and parses it once on load.
 *
 * A visit downloads it fresh at most once an hour; any repeat visit within
 * that hour reuses a local cached copy instead of re-downloading it every
 * time (see catalogCache.js). The resolved object's `fromCache` flag says
 * which one happened. `force` skips the cached copy (see refreshCatalog).
 *
 * The omitted derived fields (imageUrl, detailUrl, priceDisplay) are filled
 * back in here once, so the rest of the app reads them as before.
 *
 * `version` (a generatedAt from /api/meta) asks for that exact build, past any
 * edge-cached older one.
 *
 * @param {{ force?: boolean, version?: string }} [options]
 * @returns {Promise<import('../lib/types.js').CatalogPayload & { fromCache: boolean }>}
 */
export async function fetchCatalog({ force = false, version } = {}) {
  let data, fromCache
  try {
    ;({ data, fromCache } = await getCachedCatalog({ force, version }))
  } catch (err) {
    throw new Error(`Could not load the card catalog. (${err.message})`)
  }

  if (!data || !Array.isArray(data.cards)) {
    throw new Error('Card catalog response has an unexpected shape.')
  }
  if (data.v !== CATALOG_FORMAT_VERSION) {
    throw new Error('Card catalog response has an unexpected format version -- try reloading the page.')
  }
  hydrateCards(data.cards)
  // Fire and forget: the pre-split ~30 MB copy is useless now.
  dropLegacyCatalogCache()
  return { ...data, fromCache }
}

/**
 * Re-fetches the catalog from the network, bypassing the daily cache, and
 * only once that succeeds replaces the cached copy and drops the price
 * history / market movers / detail shard caches (so they can't disagree with
 * the fresh catalog; they reload lazily when next needed). A failure -- offline, a
 * 5xx, or an empty catalog -- rejects and leaves every cache as it was, so
 * the page can keep showing what it already has.
 * @param {{ version?: string }} [options]  a known newer build (a generatedAt from /api/meta)
 * @returns {Promise<import('../lib/types.js').CatalogPayload & { fromCache: boolean }>}
 */
export async function refreshCatalog({ version } = {}) {
  // Without a known version, ask /api/meta for the latest one (best effort) so
  // the request skips the edge cache; a failure just falls back to the plain URL.
  const target = version ?? (await fetchMeta().catch(() => null))?.generatedAt
  const result = await fetchCatalog({ force: true, version: target })
  if (result.cards.length === 0) throw new Error('The server returned an empty card catalog.')
  await clearHistoryCache()
  await clearDetailsCache()
  return result
}
