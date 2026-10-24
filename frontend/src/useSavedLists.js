import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_ITEMS, clampQty } from './limits'
import { MAX_LISTS, cleanName, itemName, itemOf, sanitizeLists } from './savedListsData'
import { mergeLists } from './listTransfer'

// Saved lists: named copies of the price list (the calculator), put aside in
// localStorage to compare against today's prices later or load back. Each
// item is a snapshot from save time (or the last refresh) -- the price it
// had then, and enough of the card to show it even once it's gone from the
// catalog. Only `refresh` reads the catalog, and is handed it; otherwise the
// sheet joins current prices on by id.

export const SAVED_LISTS_KEY = 'yuyutei:saved-lists'
// How long the sheet offers "Undo" after a row is removed.
const UNDO_MS = 8000

// Why a write didn't reach storage; the change still stands in this tab.
export const STORAGE_NOTES = {
  full: 'Your browser’s storage is full, so recent changes to saved lists only last until this tab closes. Delete a list (back it up with Export lists first) to make room.',
  unavailable: 'This browser isn’t letting the site store data, so saved lists only last until this tab closes.',
}

/**
 * Message for a save() result: what the form shows (and stays open) for
 * `limit`, else the confirmation, flagged when it only lives in this tab.
 */
export function saveResultText({ name, error }) {
  if (error === 'limit') return `You have ${MAX_LISTS} saved lists — delete one to save another.`
  if (error) return `Saved “${name}” for this tab only — ${error === 'full' ? 'browser storage is full' : 'this browser blocks site storage'}.`
  return `Saved “${name}”.`
}

/** What a refresh() result did, for the sheet's Undo bar and the screen reader. */
export function refreshResultText({ names, prices, unlisted }) {
  const parts = []
  if (names) parts.push(`${names.toLocaleString()} ${names === 1 ? 'name' : 'names'}`)
  if (prices) parts.push(`${prices.toLocaleString()} ${prices === 1 ? 'price' : 'prices'}`)
  const kept = unlisted ? ` ${unlisted.toLocaleString()} no longer listed, so kept as saved.` : ''
  return parts.length ? `Updated ${parts.join(' and ')} to today’s.${kept}` : `Already matches today’s names and prices.${kept}`
}

// randomUUID needs a secure context (https / localhost); anything else gets
// a time + random id, which is plenty for a few dozen lists in one browser.
function newId() {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

function parseStored(raw) {
  try {
    const data = JSON.parse(raw)
    return data && data.v === 1 ? sanitizeLists(data.lists) : []
  } catch {
    return []
  }
}

function readStored() {
  try {
    const raw = localStorage.getItem(SAVED_LISTS_KEY)
    return raw ? parseStored(raw) : []
  } catch {
    return []
  }
}

// null when the write stuck, else a STORAGE_NOTES key. Safari and Chrome
// throw QuotaExceededError, older Firefox NS_ERROR_DOM_QUOTA_REACHED;
// anything else (SecurityError) means storage is switched off.
function writeStored(lists) {
  try {
    if (lists.length === 0) localStorage.removeItem(SAVED_LISTS_KEY)
    else localStorage.setItem(SAVED_LISTS_KEY, JSON.stringify({ v: 1, lists }))
    return null
  } catch (err) {
    return err?.name === 'QuotaExceededError' || err?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ? 'full' : 'unavailable'
  }
}

const DAY_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** "Oct 14, 2026", or "Oct 14, 2026 (2)" if a list already has that name. */
export function defaultListName(lists, now = new Date()) {
  const base = DAY_FMT.format(now)
  const taken = new Set(lists.map((list) => list.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} (${n})`)) return `${base} (${n})`
}

// The fields of a saved item a refresh can bring up to date.
const NAME_FIELDS = ['nameEn', 'nameJp', 'setCode', 'rarity']

/**
 * Lists are { id, name, createdAt, updatedAt, pricedAt, items } (times in
 * ms), oldest first, with `pricedAt` when the items' snapshot was taken (the
 * save, or the last refresh); items are { id, qty, price, nameEn, nameJp,
 * setCode, rarity } with `price` the JPY price then. Changes are written to storage as they
 * happen (not from an effect) so `save` can tell its caller whether the list
 * actually stuck.
 */
export function useSavedLists() {
  const [lists, setLists] = useState(readStored)
  // null, or why the last write failed (a STORAGE_NOTES key).
  const [storageError, setStorageError] = useState(null)
  // { listId, itemId (null for a refresh), restore (the list fields it puts back), label }
  const [undoInfo, setUndoInfo] = useState(null)
  const listsRef = useRef(lists)
  const undoRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  // Every change goes through here: state and ref together (so two changes
  // in one tick compose), then storage. Any change other than the removal
  // that offers it retires the Undo, which would otherwise roll it back.
  const commit = useCallback((next, undo = null) => {
    listsRef.current = next
    setLists(next)
    const error = writeStored(next)
    setStorageError(error)
    clearTimeout(timerRef.current)
    undoRef.current = undo
    setUndoInfo(undo)
    if (undo) {
      timerRef.current = setTimeout(() => {
        undoRef.current = null
        setUndoInfo(null)
      }, UNDO_MS)
    }
    return error
  }, [])

  // Replaces one list with `fn(list)`, stamping updatedAt. Nothing happens
  // (no write) if the list is gone or `fn` handed it back unchanged.
  const updateList = useCallback(
    (listId, fn, undo) => {
      const prev = listsRef.current
      const index = prev.findIndex((list) => list.id === listId)
      if (index < 0) return
      const next = fn(prev[index])
      if (next === prev[index]) return
      commit(
        prev.map((list, i) => (i === index ? { ...next, updatedAt: Date.now() } : list)),
        undo
      )
    },
    [commit]
  )

  /**
   * Saves calculator `lines` as a new list. Returns { id, name, error }:
   * error 'limit' means nothing was saved; a STORAGE_NOTES key means it was,
   * for this tab only.
   */
  const save = useCallback(
    (name, lines) => {
      const prev = listsRef.current
      if (prev.length >= MAX_LISTS) return { id: null, name: null, error: 'limit' }
      const now = Date.now()
      const list = {
        id: newId(),
        name: cleanName(name) || defaultListName(prev),
        createdAt: now,
        updatedAt: now,
        pricedAt: now,
        items: lines.slice(0, MAX_ITEMS).map(itemOf),
      }
      return { id: list.id, name: list.name, error: commit([...prev, list]) }
    },
    [commit]
  )

  const rename = useCallback(
    (listId, name) => {
      const clean = cleanName(name)
      if (clean) updateList(listId, (list) => (list.name === clean ? list : { ...list, name: clean }))
    },
    [updateList]
  )

  const remove = useCallback(
    (listId) => {
      const prev = listsRef.current
      if (prev.some((list) => list.id === listId)) commit(prev.filter((list) => list.id !== listId))
    },
    [commit]
  )

  const setQty = useCallback(
    (listId, itemId, qty) => {
      const q = clampQty(qty)
      updateList(listId, (list) => {
        const index = list.items.findIndex((item) => item.id === itemId)
        if (index < 0 || list.items[index].qty === q) return list
        return { ...list, items: list.items.map((item, i) => (i === index ? { ...item, qty: q } : item)) }
      })
    },
    [updateList]
  )

  const removeItem = useCallback(
    (listId, itemId) => {
      const list = listsRef.current.find((l) => l.id === listId)
      const gone = list?.items.find((item) => item.id === itemId)
      if (!gone) return
      updateList(listId, (l) => ({ ...l, items: l.items.filter((item) => item.id !== itemId) }), {
        listId,
        itemId,
        restore: { items: list.items },
        label: `Removed ${itemName(gone)}`,
      })
    },
    [updateList]
  )

  /**
   * Re-takes each item's names and price from `cardsById` (today's catalog),
   * as if the list were saved again now, keeping quantities and order. Cards
   * the catalog no longer has keep their snapshot. Returns { names, prices,
   * unlisted } counts of items changed / left alone; nothing is written (or
   * offered to undo) if no item changed.
   */
  const refresh = useCallback(
    (listId, cardsById) => {
      const list = listsRef.current.find((l) => l.id === listId)
      if (!list) return null
      let names = 0
      let prices = 0
      let unlisted = 0
      const items = list.items.map((item) => {
        const card = cardsById.get(item.id)
        if (!card) {
          unlisted++
          return item
        }
        const next = itemOf({ ...card, qty: item.qty })
        const named = NAME_FIELDS.some((key) => next[key] !== item[key])
        const priced = next.price !== item.price
        if (named) names++
        if (priced) prices++
        return named || priced ? next : item
      })
      if (names || prices) {
        updateList(listId, (l) => ({ ...l, items, pricedAt: Date.now() }), {
          listId,
          itemId: null,
          restore: { items: list.items, pricedAt: list.pricedAt },
          label: refreshResultText({ names, prices, unlisted }),
        })
      }
      return { names, prices, unlisted }
    },
    [updateList]
  )

  /**
   * Adds or updates lists from another browser (a link or backup file,
   * already read and checked by listTransfer.js), as mergeLists() plans it.
   * Returns { counts, firstId, error }; nothing is written if nothing changed.
   */
  const importLists = useCallback(
    (incoming) => {
      const { lists: next, counts, firstId } = mergeLists(listsRef.current, incoming)
      return { counts, firstId, error: firstId ? commit(next) : null }
    },
    [commit]
  )

  const undo = useCallback(() => {
    const info = undoRef.current
    if (info) updateList(info.listId, (list) => ({ ...list, ...info.restore }))
  }, [updateList])

  // Another tab changed the lists. Its write succeeded, so storage and this
  // tab agree again (dropping any change that only lived in memory here).
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== SAVED_LISTS_KEY) return
      const next = e.newValue ? parseStored(e.newValue) : []
      listsRef.current = next
      setLists(next)
      setStorageError(null)
      // An Undo captured before the sync would resurrect the old rows.
      clearTimeout(timerRef.current)
      undoRef.current = null
      setUndoInfo(null)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return { lists, storageError, save, rename, remove, setQty, removeItem, refresh, importLists, undo, undoInfo }
}
