import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatPrice } from './currency'

// The price calculator's list: which cards, how many of each, and a
// snapshot of each card's price/stock so the sum still adds up when the card
// is missing from the loaded catalog (delisted, or the catalog is mid-load).

export const STORAGE_KEY = 'yuyutei:calculator'
export const MAX_ITEMS = 300
export const MAX_QTY = 99
// How long the bar offers "Undo" after a removal.
const UNDO_MS = 8000

const clampQty = (n) => Math.min(MAX_QTY, Math.max(1, Math.round(Number(n)) || 1))
const nameOf = (src) => src.nameEn || src.nameJp || src.setCode || 'card'

function snapOf(card) {
  return {
    price: card.price ?? null,
    stock: card.stock ?? null,
    nameEn: card.nameEn || null,
    nameJp: card.nameJp || null,
    setCode: card.setCode || null,
    rarity: card.rarity || null,
    imageUrl: card.imageUrl || null,
    detailUrl: card.detailUrl || null,
  }
}

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const strOrNull = (v) => (typeof v === 'string' && v ? v : null)

// Storage is shared with other tabs and could hold anything, so every field
// is re-validated on the way in rather than trusted.
function parseStored(raw) {
  try {
    const data = JSON.parse(raw)
    if (!data || data.v !== 1 || !Array.isArray(data.items)) return []
    const seen = new Set()
    const items = []
    for (const entry of data.items) {
      if (!entry || typeof entry.id !== 'string' || seen.has(entry.id)) continue
      seen.add(entry.id)
      const s = entry.snap && typeof entry.snap === 'object' ? entry.snap : {}
      items.push({
        id: entry.id,
        qty: clampQty(entry.qty),
        at: numOrNull(entry.at) ?? 0,
        snap: {
          price: numOrNull(s.price),
          stock: numOrNull(s.stock),
          nameEn: strOrNull(s.nameEn),
          nameJp: strOrNull(s.nameJp),
          setCode: strOrNull(s.setCode),
          rarity: strOrNull(s.rarity),
          imageUrl: strOrNull(s.imageUrl),
          detailUrl: strOrNull(s.detailUrl),
        },
      })
      if (items.length >= MAX_ITEMS) break
    }
    return items
  } catch {
    return []
  }
}

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? parseStored(raw) : []
  } catch {
    return []
  }
}

// Which flags a line carries; the panel words them and the bar counts them.
function flagsFor(item, listed) {
  const { price, stock } = item.snap
  const flags = []
  if (!listed) flags.push('unlisted')
  if (price == null) flags.push('noprice')
  if (stock === 0) flags.push('oos')
  else if (stock != null && item.qty > stock) flags.push('over')
  return flags
}

// Cards / JPY sum of a list, for freezing into an action's message.
function summaryOf(items) {
  let totalJpy = 0
  for (const { qty, snap } of items) if (snap.price != null) totalJpy += snap.price * qty
  return { cards: items.length, totalJpy }
}

// Totals are integer JPY. `totalJpy` deliberately includes out-of-stock and
// unlisted cards (the point is adding up the prices; silently leaving them
// out would look like a bug); `buyableJpy` is what could actually be bought.
function computeTotals(lines) {
  let totalJpy = 0
  let buyableJpy = 0
  let copies = 0
  let issues = 0
  for (const line of lines) {
    copies += line.qty
    if (line.flags.length > 0) issues += 1
    if (line.price == null) continue
    totalJpy += line.price * line.qty
    if (line.listed && line.stock !== 0) {
      buyableJpy += line.price * (line.stock == null ? line.qty : Math.min(line.qty, line.stock))
    }
  }
  return { totalJpy, buyableJpy, cards: lines.length, copies, issues }
}

/**
 * `cardsById` is the loaded catalog; `catalogGeneratedAt` its build time.
 * Items are { id, qty, at, snap } where `at` is the time (ms) the snapshot's
 * price/stock is known to be from. Newer data wins: a Movers tile can carry a
 * fresher price than the catalog, which then stands until a catalog built
 * after it arrives (Refresh now), at which point every line updates.
 */
export function useCalculator({ cardsById, catalogReady, catalogGeneratedAt }) {
  const [items, setItems] = useState(readStored)
  const [undoInfo, setUndoInfo] = useState(null) // { items, label }
  const [message, setMessage] = useState(null) // { text, kind } last action, for the live region
  const timerRef = useRef(null)
  const undoRef = useRef(null)
  // Mirrors of state/props that callbacks read, so those callbacks keep a
  // stable identity (tiles are memoized on `onToggle`).
  const itemsRef = useRef(items)
  const cardsByIdRef = useRef(cardsById)
  const generatedAtRef = useRef(catalogGeneratedAt)

  useEffect(() => {
    itemsRef.current = items
  }, [items])
  useEffect(() => {
    cardsByIdRef.current = cardsById
    generatedAtRef.current = catalogGeneratedAt
  }, [cardsById, catalogGeneratedAt])
  useEffect(() => () => clearTimeout(timerRef.current), [])

  // When this card's price/stock is known to be from: the catalog's build
  // time for a catalog object, "now" for anything else (a Movers copy, whose
  // data is newer than the catalog's but has no timestamp of its own).
  const atFor = useCallback((card) => {
    if (cardsByIdRef.current.get(card.id) === card) return Date.parse(generatedAtRef.current) || 0
    return Date.now()
  }, [])

  // Every user-driven change goes through here: update state and the ref
  // together (so two changes in one tick compose), and arm the undo/notice
  // timeout. `undo` is the previous list to offer restoring, if any.
  const commit = useCallback((next, { text, kind = 'info', undo = null }) => {
    itemsRef.current = next
    setItems(next)
    undoRef.current = undo ? { items: undo, label: text } : null
    setUndoInfo(undoRef.current)
    // The summary is frozen here (not recomputed from live totals) so the
    // bar's live region only speaks when something was actually done.
    setMessage({ text, kind, ...summaryOf(next) })
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      undoRef.current = null
      setUndoInfo(null)
      setMessage((m) => (m && m.kind === 'full' ? null : m))
    }, UNDO_MS)
  }, [])

  const notifyFull = useCallback(() => {
    clearTimeout(timerRef.current)
    undoRef.current = null
    setUndoInfo(null)
    setMessage({ text: `List is full (${MAX_ITEMS} cards)`, kind: 'full' })
    timerRef.current = setTimeout(() => setMessage(null), UNDO_MS)
  }, [])

  const removeAt = useCallback(
    (prev, index) => {
      const gone = prev[index]
      commit(prev.filter((_, i) => i !== index), {
        text: `Removed ${nameOf(gone.snap)}`,
        kind: 'removed',
        undo: prev,
      })
    },
    [commit]
  )

  const toggle = useCallback(
    (card) => {
      const prev = itemsRef.current
      const index = prev.findIndex((i) => i.id === card.id)
      if (index >= 0) return removeAt(prev, index)
      if (prev.length >= MAX_ITEMS) return notifyFull()
      commit([...prev, { id: card.id, qty: 1, at: atFor(card), snap: snapOf(card) }], {
        text: `Added ${nameOf(card)}`,
      })
    },
    [atFor, commit, notifyFull, removeAt]
  )

  // Add / change / remove (qty 0) from a card object; used by the modal.
  const setQtyFor = useCallback(
    (card, qty) => {
      const prev = itemsRef.current
      const index = prev.findIndex((i) => i.id === card.id)
      if (!(qty >= 1)) return index >= 0 ? removeAt(prev, index) : undefined
      const q = clampQty(qty)
      if (index < 0) {
        if (prev.length >= MAX_ITEMS) return notifyFull()
        return commit([...prev, { id: card.id, qty: q, at: atFor(card), snap: snapOf(card) }], {
          text: `Added ${nameOf(card)}`,
        })
      }
      const at = atFor(card)
      // Only refresh the snapshot from a card at least as new as it, so
      // opening a card from the (older) catalog doesn't undo a fresher
      // Movers price the line already has.
      const fresher = at >= prev[index].at
      commit(
        prev.map((item, i) =>
          i === index ? { ...item, qty: q, ...(fresher ? { at, snap: snapOf(card) } : null) } : item
        ),
        { text: `${nameOf(prev[index].snap)} × ${q}` }
      )
    },
    [atFor, commit, notifyFull, removeAt]
  )

  const setQty = useCallback(
    (id, qty) => {
      const prev = itemsRef.current
      const index = prev.findIndex((i) => i.id === id)
      if (index < 0) return
      const q = clampQty(qty)
      if (prev[index].qty === q) return
      commit(
        prev.map((item, i) => (i === index ? { ...item, qty: q } : item)),
        { text: `${nameOf(prev[index].snap)} × ${q}` }
      )
    },
    [commit]
  )

  const remove = useCallback(
    (id) => {
      const prev = itemsRef.current
      const index = prev.findIndex((i) => i.id === id)
      if (index >= 0) removeAt(prev, index)
    },
    [removeAt]
  )

  const clear = useCallback(() => {
    const prev = itemsRef.current
    if (prev.length === 0) return
    commit([], { text: `List cleared (${prev.length} ${prev.length === 1 ? 'card' : 'cards'})`, kind: 'cleared', undo: prev })
  }, [commit])

  const undo = useCallback(() => {
    const info = undoRef.current
    if (!info) return
    clearTimeout(timerRef.current)
    undoRef.current = null
    itemsRef.current = info.items
    setItems(info.items)
    setUndoInfo(null)
    setMessage({ text: 'Restored', kind: 'info', ...summaryOf(info.items) })
  }, [])

  // Newer data wins: when a catalog built after a line's snapshot arrives,
  // that line takes the catalog's price/stock. Returns `prev` untouched when
  // nothing changed, so there is no write and no render loop.
  useEffect(() => {
    const catalogMs = Date.parse(catalogGeneratedAt)
    if (!catalogReady || !Number.isFinite(catalogMs)) return
    // Through the ref (not a functional setItems) so a user change right
    // after this builds on the refreshed list.
    let changed = false
    const next = itemsRef.current.map((item) => {
      const card = cardsById.get(item.id)
      if (!card || catalogMs <= item.at) return item
      changed = true
      return { ...item, at: catalogMs, snap: snapOf(card) }
    })
    if (!changed) return
    itemsRef.current = next
    setItems(next)
  }, [cardsById, catalogReady, catalogGeneratedAt])

  // Persist. Only writes when the serialized list differs from what is
  // stored: the write a `storage` event reacts to must not echo back to the
  // tab that made it (and an untouched empty list shouldn't create a key).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === null && items.length === 0) return
      const json = JSON.stringify({ v: 1, items })
      if (json !== stored) localStorage.setItem(STORAGE_KEY, json)
    } catch {
      // Private browsing / storage disabled -- the list lives in memory.
    }
  }, [items])

  // Another tab changed the list.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY) return
      const next = e.newValue ? parseStored(e.newValue) : []
      itemsRef.current = next
      setItems(next)
      // An Undo captured before the sync would resurrect the old list.
      clearTimeout(timerRef.current)
      undoRef.current = null
      setUndoInfo(null)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const qtyById = useMemo(() => new Map(items.map((i) => [i.id, i.qty])), [items])

  const lines = useMemo(
    () =>
      items.map((item) => {
        const card = cardsById.get(item.id) || null
        // Never "no longer listed" while the catalog is still loading.
        const listed = !catalogReady || card !== null
        const src = card || item.snap
        return {
          id: item.id,
          qty: item.qty,
          card,
          listed,
          price: item.snap.price,
          stock: item.snap.stock,
          lineJpy: item.snap.price == null ? null : item.snap.price * item.qty,
          flags: flagsFor(item, listed),
          nameEn: src.nameEn,
          nameJp: src.nameJp,
          setCode: src.setCode,
          rarity: src.rarity,
          imageUrl: src.imageUrl,
          detailUrl: src.detailUrl,
        }
      }),
    [items, cardsById, catalogReady]
  )

  const totals = useMemo(() => computeTotals(lines), [lines])

  return { items, qtyById, lines, totals, toggle, setQtyFor, setQty, remove, clear, undo, undoInfo, message }
}

const jpy = (n) => formatPrice(n, 'JPY', null)

/** Plain-text version of the list for the clipboard. */
export function formatListAsText(lines, totals, currency, rates) {
  const out = []
  for (const line of lines) {
    const name = nameOf(line)
    const tag = [line.setCode, line.rarity].filter(Boolean).join(' ')
    const head = `${line.qty} × ${name}${tag ? ` [${tag}]` : ''}`
    out.push(line.price == null ? `${head} — no price` : `${head} — ${jpy(line.price)} each = ${jpy(line.lineJpy)}`)
    if (line.detailUrl) out.push(`    ${line.detailUrl}`)
  }
  const approx = currency !== 'JPY' && rates ? ` (≈ ${formatPrice(totals.totalJpy, currency, rates)})` : ''
  out.push(`Total: ${totals.copies} ${totals.copies === 1 ? 'copy' : 'copies'} — ${jpy(totals.totalJpy)}${approx}`)
  return out.join('\n')
}
