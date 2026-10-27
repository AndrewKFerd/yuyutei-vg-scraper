import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSeries, loadHistory } from '../../data/history'
import { useStorageEvent } from '../../data/useStorageEvent'
import { isoToMinute } from '../../lib/format'
import { MAX_WATCHED, cleanTarget, currentState, sanitizeWatchlist, snapOf, sortRows, watchRow } from './watchlistData'

// The watchlist: cards to keep an eye on, each with the price and stock it
// had when last looked at, so the Watchlist view (and the count on its tab)
// can say what changed since. Kept in localStorage, like the price list.
//
// Price history loads as soon as anything is watched (not just when the
// view opens), so the tab's count and the view agree: it holds changes
// newer than a cached catalog, and the ups and downs in between.

export const WATCHLIST_KEY = 'yuyutei:watchlist'

const nowMinute = () => Math.floor(Date.now() / 60000)

function parseStored(raw) {
  try {
    const data = JSON.parse(raw)
    return data && data.v === 1 ? sanitizeWatchlist(data.items) : []
  } catch {
    return []
  }
}

function readStored() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY)
    return raw ? parseStored(raw) : []
  } catch {
    return []
  }
}

/**
 * `cardsById` / `catalogReady` / `catalogGeneratedAt` are the loaded
 * catalog; `dataVersion` goes up after a catalog refresh, which also drops
 * the cached history, so it reloads.
 */
export function useWatchlist({ cardsById, catalogReady, catalogGeneratedAt, dataVersion }) {
  const [items, setItems] = useState(readStored)
  // undefined = not loaded (or nothing watched), null = unavailable.
  const [history, setHistory] = useState(/** @type {import('../../lib/types.js').History | null | undefined} */ (undefined))
  const itemsRef = useRef(items)
  const watching = items.length > 0

  useEffect(() => {
    if (!watching) return
    let cancelled = false
    loadHistory().then((h) => {
      if (!cancelled) setHistory(h)
    })
    return () => {
      cancelled = true
    }
  }, [watching, dataVersion])

  const catalogMinute = catalogGeneratedAt ? isoToMinute(catalogGeneratedAt) : null
  // The newest minute the prices on hand are good for.
  const asOf = Math.max(catalogMinute ?? 0, history?.lastRun ?? 0)

  // Mirrors for the callbacks below, so they keep a stable identity.
  const ctxRef = useRef({ cardsById, history, catalogMinute, asOf })
  useEffect(() => {
    ctxRef.current = { cardsById, history, catalogMinute, asOf }
  }, [cardsById, history, catalogMinute, asOf])

  const stateOf = useCallback((card) => {
    const { history: h, catalogMinute: m, asOf: at } = ctxRef.current
    return currentState(card, getSeries(h, card.id), m, at)
  }, [])

  // State and ref together, so two changes in one tick compose.
  const commit = useCallback((next) => {
    itemsRef.current = next
    setItems(next)
  }, [])

  /** Starts watching `cards` (catalog cards) not already watched. Returns how many were added. */
  const addCards = useCallback(
    (cards) => {
      const prev = itemsRef.current
      const have = new Set(prev.map((item) => item.id))
      const added = []
      for (const card of cards) {
        if (!card || have.has(card.id) || prev.length + added.length >= MAX_WATCHED) continue
        have.add(card.id)
        const { price, stock, at } = stateOf(card)
        added.push({ id: card.id, addedAt: nowMinute(), target: null, seen: { price, stock, at }, snap: snapOf(card) })
      }
      if (added.length) commit([...prev, ...added])
      return added.length
    },
    [commit, stateOf]
  )

  const remove = useCallback(
    (id) => {
      const prev = itemsRef.current
      if (prev.some((item) => item.id === id)) commit(prev.filter((item) => item.id !== id))
    },
    [commit]
  )

  /** Watch or stop watching one card (the card modal's button). */
  const toggle = useCallback(
    (card) => (itemsRef.current.some((item) => item.id === card.id) ? remove(card.id) : addCards([card])),
    [addCards, remove]
  )

  const setTarget = useCallback(
    (id, value) => {
      const target = cleanTarget(value)
      const prev = itemsRef.current
      const index = prev.findIndex((item) => item.id === id)
      if (index < 0 || prev[index].target === target) return
      commit(prev.map((item, i) => (i === index ? { ...item, target } : item)))
    },
    [commit]
  )

  // Moves the `seen` snapshot of the cards in `ids` (all, when null) up to
  // now. Cards the catalog doesn't have keep theirs.
  const markSeen = useCallback(
    (ids = null) => {
      const { cardsById: byId } = ctxRef.current
      const only = ids ? new Set(ids) : null
      let changed = false
      const next = itemsRef.current.map((item) => {
        const card = byId.get(item.id)
        if (!card || (only && !only.has(item.id))) return item
        const seen = stateOf(card)
        if (seen.price === item.seen.price && seen.stock === item.seen.stock && seen.at === item.seen.at) return item
        changed = true
        return { ...item, seen }
      })
      if (changed) commit(next)
    },
    [commit, stateOf]
  )

  // Persist; skipped while nothing is stored and nothing is watched.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(WATCHLIST_KEY)
      if (stored === null && items.length === 0) return
      const json = JSON.stringify({ v: 1, items })
      if (json !== stored) localStorage.setItem(WATCHLIST_KEY, json)
    } catch {
      // Private browsing / storage disabled -- the list lives in memory.
    }
  }, [items])

  // Another tab changed the list.
  useStorageEvent(WATCHLIST_KEY, (value) => commit(value ? parseStored(value) : []))

  const watchedIds = useMemo(() => new Set(items.map((item) => item.id)), [items])

  // Nothing counts as news until the catalog is in: before that every card
  // would read as missing.
  const rows = useMemo(() => {
    if (!catalogReady) return []
    return sortRows(
      items.map((item) =>
        watchRow(item, {
          card: cardsById.get(item.id) || null,
          series: getSeries(history ?? null, item.id),
          catalogMinute,
          asOf,
        })
      )
    )
  }, [items, cardsById, catalogReady, history, catalogMinute, asOf])

  const newsCount = useMemo(() => rows.filter((row) => row.news).length, [rows])

  return {
    items,
    rows,
    newsCount,
    watchedIds,
    history,
    asOf,
    addCards,
    toggle,
    remove,
    setTarget,
    markSeen,
  }
}
