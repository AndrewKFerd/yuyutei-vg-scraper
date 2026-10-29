// Live updates: /api/meta says what the newest published catalog is, and
// /api/deltas/<stamp> carries the price/stock changes between two builds
// (written by pipeline/build-delta.js). Together they bring a loaded catalog
// up to date without downloading it again; anything a delta can't express
// (new cards, renames) makes planCatchUp answer 'reload' instead.
import { withCurrent } from '../lib/catalogFormat.js'

export const META_URL = '/api/meta'
export const DELTAS_URL_PREFIX = '/api/deltas/'

/** @typedef {{ from: string, to: string, key: string, n: number }} DeltaRef */
/** @typedef {{ v: 1, generatedAt: string, structHash: string, deltas: DeltaRef[] }} Meta */
/** @typedef {{ v: 1, from: string, to: string, changes: [string, number | null, number | null][] }} Delta */

function isMeta(data) {
  return (
    data?.v === 1 &&
    typeof data.generatedAt === 'string' &&
    typeof data.structHash === 'string' &&
    Array.isArray(data.deltas)
  )
}

function isDelta(data) {
  return data?.v === 1 && typeof data.from === 'string' && typeof data.to === 'string' && Array.isArray(data.changes)
}

/**
 * The newest published meta. Skips the browser's own cache (the edge keeps it
 * for 15 s); rejects on a network/HTTP failure or an unexpected payload.
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<Meta>}
 */
export async function fetchMeta({ signal } = {}) {
  const response = await fetch(META_URL, { cache: 'no-store', signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  if (!isMeta(data)) throw new Error('unexpected update info')
  return data
}

/**
 * One delta by its bucket key ("deltas/<stamp>.json"). Deltas never change, so
 * the browser's HTTP cache may serve them.
 * @param {string} key
 * @returns {Promise<Delta>}
 */
export async function fetchDelta(key) {
  const stamp = /^deltas\/(\d{8}T\d{6}Z)\.json$/.exec(key)?.[1]
  if (!stamp) throw new Error('bad delta key')
  const response = await fetch(`${DELTAS_URL_PREFIX}${stamp}`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  if (!isDelta(data)) throw new Error('unexpected update')
  return data
}

/**
 * What to do to bring the catalog the page holds up to date with `meta`:
 *  - none:   already current (or newer than the meta, which can lag at the edge)
 *  - patch:  fetch and apply `keys` in order
 *  - reload: fetch the whole catalog (its structure changed, or the chain
 *            doesn't reach back to the copy the page has)
 * @param {Meta} meta
 * @param {{ generatedAt?: string, structHash?: string }} loaded
 * @returns {{ action: 'none' } | { action: 'reload', reason: string } | { action: 'patch', keys: string[] }}
 */
export function planCatchUp(meta, loaded) {
  if (!loaded?.generatedAt) return { action: 'reload', reason: 'no loaded catalog' }
  if (loaded.generatedAt === meta.generatedAt) return { action: 'none' }
  const loadedAt = Date.parse(loaded.generatedAt)
  const metaAt = Date.parse(meta.generatedAt)
  if (Number.isFinite(loadedAt) && Number.isFinite(metaAt) && loadedAt > metaAt) return { action: 'none' }
  if (!loaded.structHash || loaded.structHash !== meta.structHash) return { action: 'reload', reason: 'structure changed' }

  const start = meta.deltas.findIndex((d) => d.from === loaded.generatedAt)
  if (start === -1) return { action: 'reload', reason: 'catalog older than the update chain' }
  const chain = meta.deltas.slice(start)
  for (let i = 1; i < chain.length; i++) {
    if (chain[i].from !== chain[i - 1].to) return { action: 'reload', reason: 'broken update chain' }
  }
  if (chain[chain.length - 1].to !== meta.generatedAt) return { action: 'reload', reason: 'update chain ends early' }
  return { action: 'patch', keys: chain.map((d) => d.key) }
}

/**
 * The catalog's cards with the deltas' prices and stock applied, in order. A
 * new array, but a card no delta touches (or that ends up unchanged) is the
 * same object, so memoized tiles don't re-render. Ids the catalog doesn't
 * hold are ignored. Cards that changed go through withCurrent(), which also
 * drops their now-stale 7-day change.
 * @param {import('../lib/types.js').Card[]} cards
 * @param {Delta[]} deltas
 * @returns {import('../lib/types.js').Card[]}
 */
export function applyDeltas(cards, deltas) {
  const latest = new Map()
  for (const delta of deltas) {
    for (const [id, price, stock] of delta.changes) latest.set(id, [price, stock])
  }
  if (latest.size === 0) return cards
  return cards.map((card) => {
    const next = latest.get(card.id)
    return next ? withCurrent(card, next[0], next[1]) : card
  })
}
