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
// Sets whose memoized shard came from the network (not Cache Storage) in this
// session, i.e. can't be older than the page load.
const fetchedFresh = new Set()

function startLoad(setSlug, { force }) {
  const url = `${DETAILS_URL_PREFIX}${encodeURIComponent(setSlug)}`
  const promise = getCachedJson(url, { ttlMs: DETAILS_TTL_MS, validate: isValidShard, force }).then(
    ({ data, fromCache }) => {
      if (!isValidShard(data)) throw new Error('unexpected response')
      if (!fromCache) fetchedFresh.add(setSlug)
      return data.cards
    }
  )
  loads.set(setSlug, promise)
  promise.catch(() => {
    if (loads.get(setSlug) === promise) loads.delete(setSlug)
  })
  return promise
}

/**
 * Resolves to the set's `{ [cardId]: { skillTextEn, ... } }` map. Rejects on
 * a network/HTTP failure (including a 404 for a shard the pipeline hasn't
 * uploaded) so the caller can show an error with a retry.
 */
export function loadSetDetails(setSlug) {
  return loads.get(setSlug) || startLoad(setSlug, { force: false })
}

/**
 * For a card the loaded shard has no entry for. That is normal for a card
 * with no text at all, but it is also what a shard cached before the card
 * existed looks like. If the shard came from the cache, fetch it once more
 * bypassing the cache and resolve to the new map; resolves null when that
 * can't tell us anything new (it already came from the network this session).
 */
export function reloadSetDetailsIfCached(setSlug) {
  if (fetchedFresh.has(setSlug)) return Promise.resolve(null)
  return startLoad(setSlug, { force: true })
}

/** Drops the in-memory and cached shards (used by the header's refresh button); they reload lazily. */
export async function clearDetailsCache() {
  loads.clear()
  fetchedFresh.clear()
  await clearCachedJsonByPrefix(DETAILS_URL_PREFIX)
}
