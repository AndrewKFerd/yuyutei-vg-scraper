import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchCatalog, refreshCatalog } from '../data/api'
import { clearHistoryCache } from '../data/history'

/** @typedef {import('../lib/types.js').CatalogPayload} CatalogPayload */

/**
 * The card catalog: loaded on mount (from the cache when fresh), retried on
 * request, and re-fetched past the cache by `refresh`. `onLoaded(data)` and
 * `onRefreshed(data)` run in the same update that puts the new cards in
 * place -- give them stable identities (useCallback), as the load effect
 * depends on `onLoaded`.
 *
 * Returns { cards, cardsById, meta: { generatedAt, count, structHash }, nations,
 * sets, status: 'loading'|'ready'|'error', errorMessage, retry, refresh,
 * reloadTo, applyPatch, isRefreshing, refreshError, dataVersion }. `reloadTo(version)`
 * is refresh() for a known newer build; `applyPatch(cards, generatedAt)` swaps in
 * cards brought up to date by price/stock deltas (see data/deltas.js). `dataVersion` goes up after
 * each refresh (which also drops the history/movers caches), so the Movers
 * view and card modal reload them.
 * @param {{ onLoaded?: (data: CatalogPayload) => void, onRefreshed?: (data: Pick<CatalogPayload, 'cards'>) => void }} handlers
 */
export function useCatalog({ onLoaded, onRefreshed }) {
  const [cards, setCards] = useState(/** @type {import('../lib/types.js').Card[]} */ ([]))
  const [meta, setMeta] = useState(/** @type {{ generatedAt: string, count: number, structHash?: string } | null} */ (null))
  const [status, setStatus] = useState(/** @type {import('../lib/types.js').CatalogStatus} */ ('loading'))
  const [errorMessage, setErrorMessage] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  // Why the last refresh failed, shown in the header; the already-loaded
  // catalog stays up either way.
  const [refreshError, setRefreshError] = useState('')
  // [{code, label, group}] from the catalog; empty for one that predates it.
  const [nations, setNations] = useState(/** @type {CatalogPayload['nations']} */ ([]))
  // [{slug, code, name}] from the catalog; empty for one that predates it.
  const [sets, setSets] = useState(/** @type {CatalogPayload['sets']} */ ([]))
  const [dataVersion, setDataVersion] = useState(0)

  const apply = useCallback((/** @type {CatalogPayload} */ data) => {
    setCards(data.cards)
    setNations(Array.isArray(data.nations) ? data.nations : [])
    setSets(Array.isArray(data.sets) ? data.sets : [])
    setMeta({ generatedAt: data.generatedAt, count: data.count, structHash: data.structHash })
  }, [])

  useEffect(() => {
    let cancelled = false

    setStatus('loading')
    fetchCatalog()
      .then((data) => {
        if (cancelled) return
        apply(data)
        onLoaded?.(data)
        setStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        setErrorMessage(err.message)
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [loadAttempt, apply, onLoaded])

  const retry = useCallback(() => setLoadAttempt((n) => n + 1), [])

  // Manual "get the latest data now" escape hatch — bypasses the catalog
  // cache instead of waiting for it to expire on its own. A failure only
  // shows a note: the catalog already on screen (and in the cache) is
  // still good, so it stays.
  // `version` (from reloadTo) asks for that exact build; the header button calls
  // refresh with a click event, which is ignored.
  const runRefresh = useCallback(
    (version) => {
      setIsRefreshing(true)
      setRefreshError('')
      return refreshCatalog({ version })
        .then((data) => {
          apply(data)
          onRefreshed?.(data)
          setDataVersion((v) => v + 1)
        })
        .catch((err) => setRefreshError(err.message))
        .finally(() => setIsRefreshing(false))
    },
    [apply, onRefreshed]
  )
  const refresh = useCallback(() => runRefresh(), [runRefresh])
  const reloadTo = useCallback((version) => runRefresh(version), [runRefresh])

  // Cards already brought up to date by deltas: same catalog, newer prices.
  // The price history and movers describe the same moment, so they reload too.
  const applyPatch = useCallback(
    async (patched, generatedAt) => {
      await clearHistoryCache()
      setCards(patched)
      setMeta((prev) => (prev ? { ...prev, generatedAt } : prev))
      onRefreshed?.({ cards: patched })
      setDataVersion((v) => v + 1)
    },
    [onRefreshed]
  )

  // id -> card, for joining movers.json entries, saved lists and the price
  // list against the catalog.
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])

  return {
    cards,
    cardsById,
    meta,
    nations,
    sets,
    status,
    errorMessage,
    retry,
    refresh,
    reloadTo,
    applyPatch,
    isRefreshing,
    refreshError,
    dataVersion,
  }
}
