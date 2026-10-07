// Per-set card details: the heavy fields the slim catalog leaves out (skill
// text, flavor text, kind/clan/grade/power/shield, wiki page title), served
// as one file per set by api/details/[set].js and fetched when the card modal
// opens a card of that set. Nothing here runs on page load.
//
// Cached in memory for the session (opening ten cards of one set is one
// request, or one cache read) and, via catalogCache.js, in Cache Storage
// under a TTL, so a returning visitor opening a card of a set they've seen
// doesn't hit the network at all.
import { DETAILS_URL_PREFIX, clearCachedJsonByPrefix, getCachedJson } from './catalogCache'

// Shards only change when a set's text does (a pipeline scrape run by hand),
// so unlike the price files they can sit in the cache for hours.
const DETAILS_TTL_MS = 6 * 60 * 60 * 1000

function isValidShard(data) {
  return data?.v === 1 && typeof data.cards === 'object' && data.cards !== null
}

// slug -> promise of the shard's `cards` map (card id -> heavy fields).
// A failed load is forgotten so the modal's Retry (or the next open) tries
// the network again; a successful one stays for the session.
const loads = new Map()

/**
 * Resolves to the set's `{ [cardId]: { skillTextEn, ... } }` map. Rejects on
 * a network/HTTP failure (including a 404 for a shard the pipeline hasn't
 * uploaded) so the caller can show an error with a retry.
 */
export function loadSetDetails(setSlug) {
  let promise = loads.get(setSlug)
  if (!promise) {
    const url = `${DETAILS_URL_PREFIX}${encodeURIComponent(setSlug)}`
    promise = getCachedJson(url, { ttlMs: DETAILS_TTL_MS, validate: isValidShard }).then(({ data }) => {
      if (!isValidShard(data)) throw new Error('unexpected response')
      return data.cards
    })
    loads.set(setSlug, promise)
    promise.catch(() => {
      if (loads.get(setSlug) === promise) loads.delete(setSlug)
    })
  }
  return promise
}

/** Drops the in-memory and cached shards (used by "Refresh now"); they reload lazily. */
export async function clearDetailsCache() {
  loads.clear()
  await clearCachedJsonByPrefix(DETAILS_URL_PREFIX)
}
