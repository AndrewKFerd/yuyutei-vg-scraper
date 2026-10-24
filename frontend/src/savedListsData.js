// What a saved list is made of, and the checks every list goes through on
// the way in, whether from localStorage (useSavedLists.js) or an imported
// file or link (listTransfer.js). No React or browser APIs here, so the
// pipeline tests can import it.

import { MAX_ITEMS, clampQty, numOrNull, strOrNull } from './limits.js'

export const MAX_LISTS = 50
export const MAX_NAME_LENGTH = 60

export const cleanName = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH) : '')

/** A saved item from a price-list line, a catalog card or stored data. */
export function itemOf(line) {
  return {
    id: line.id,
    qty: clampQty(line.qty),
    price: numOrNull(line.price),
    nameEn: strOrNull(line.nameEn),
    nameJp: strOrNull(line.nameJp),
    setCode: strOrNull(line.setCode),
    rarity: strOrNull(line.rarity),
  }
}

/**
 * The valid lists in `entries` (anything: storage and imports are shared
 * with other tabs and other people, so every field is re-validated rather
 * than trusted). Drops entries without an id or items array and repeated
 * list or card ids, and caps lists at MAX_LISTS and items at MAX_ITEMS.
 */
export function sanitizeLists(entries) {
  if (!Array.isArray(entries)) return []
  const seen = new Set()
  const lists = []
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || seen.has(entry.id) || !Array.isArray(entry.items)) continue
    seen.add(entry.id)
    const ids = new Set()
    const items = []
    for (const item of entry.items) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) continue
      ids.add(item.id)
      items.push(itemOf(item))
      if (items.length >= MAX_ITEMS) break
    }
    const createdAt = numOrNull(entry.createdAt) ?? 0
    lists.push({
      id: entry.id,
      name: cleanName(entry.name) || 'Untitled list',
      createdAt,
      updatedAt: numOrNull(entry.updatedAt) ?? createdAt,
      // Lists from before refreshing existed were priced when saved.
      pricedAt: numOrNull(entry.pricedAt) ?? createdAt,
      items,
    })
    if (lists.length >= MAX_LISTS) break
  }
  return lists
}
