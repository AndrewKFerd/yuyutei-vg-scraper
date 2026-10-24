// Moving saved lists between browsers, which share nothing (there are no
// accounts): a link that carries the lists in its #fragment -- opened on the
// other device from a QR code or a message to yourself -- and a backup file.
// Neither is uploaded anywhere; a fragment isn't even sent to the server.
// Pure functions (CompressionStream, atob and btoa exist in Node too), so
// the pipeline tests import this.

import { MAX_LISTS, sanitizeLists } from './savedListsData.js'

export const TRANSFER_KIND = 'yytscrap-saved-lists'
export const TRANSFER_VERSION = 1
// The link's fragment: #import=z<base64url of deflated JSON>, or j<...> of
// plain JSON from a browser without CompressionStream.
const LINK_PREFIX = '#import='
// No real payload comes near this (50 lists of 300 cards with names is about
// 4 MB); it stops a crafted link from inflating without end.
export const MAX_TRANSFER_BYTES = 8 * 1024 * 1024

/** `code` is one of the keys transferErrorText() words. */
export class TransferError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

/** What went wrong reading a link or file, for the import panel. */
export function transferErrorText(code, source) {
  const what = source === 'link' ? 'link' : 'file'
  switch (code) {
    case 'newer':
      return `This ${what} was made by a newer version of the site. Reload the page and try again.`
    case 'empty':
      return `There are no saved lists in this ${what}.`
    case 'too-big':
      return `This ${what} is too big to be saved lists.`
    case 'unsupported':
      return 'This browser can’t open saved-list links. Update it, or use a backup file instead.'
    default:
      return what === 'link'
        ? 'This link doesn’t open any saved lists. It may have been cut short when it was sent: copy the whole link and try again.'
        : 'This file isn’t a saved-lists backup from this site.'
  }
}

// --- writing -----------------------------------------------------------------

// In a link every byte counts (a QR code holds about 1 KB), so a card the
// catalog has travels as [id, qty, price] and the receiving browser, which
// loads the same catalog, fills its names back in. Cards the catalog no
// longer lists keep their saved names.
const compactItem = (cardsById) => (item) =>
  cardsById?.has(item.id)
    ? [item.id, item.qty, item.price]
    : [item.id, item.qty, item.price, item.nameEn, item.nameJp, item.setCode, item.rarity]

function payloadOf(lists, writeItem) {
  return {
    kind: TRANSFER_KIND,
    v: TRANSFER_VERSION,
    exportedAt: Date.now(),
    lists: lists.map((list) => ({
      id: list.id,
      name: list.name,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
      pricedAt: list.pricedAt,
      items: list.items.map(writeItem),
    })),
  }
}

/** A backup file's text: the lists in full, names and all. */
export function backupFileText(lists) {
  return JSON.stringify(payloadOf(lists, (item) => item))
}

/** A link that opens `lists` in another browser; `origin` is the site's. */
export async function transferLink(lists, { origin, cardsById = null }) {
  const bytes = new TextEncoder().encode(JSON.stringify(payloadOf(lists, compactItem(cardsById))))
  const deflate = typeof CompressionStream === 'function'
  const body = deflate ? await pipeBytes(bytes, new CompressionStream('deflate')) : bytes
  return `${origin}/?view=lists${LINK_PREFIX}${deflate ? 'z' : 'j'}${toBase64Url(body)}`
}

// --- reading -----------------------------------------------------------------

/** Whether a location.hash is a transfer link's. */
export const isTransferHash = (hash) => typeof hash === 'string' && hash.startsWith(LINK_PREFIX)

// A link's [id, qty, price, names...] item, or a file's object, as the
// object sanitizeLists() checks.
function itemFromWire(item) {
  if (!Array.isArray(item)) return item
  const [id, qty, price, nameEn, nameJp, setCode, rarity] = item
  return { id, qty, price, nameEn, nameJp, setCode, rarity }
}

/**
 * The lists in a decoded payload, checked as strictly as stored ones.
 * Returns { lists, exportedAt }; throws a TransferError.
 */
export function readPayload(data) {
  if (!data || typeof data !== 'object' || data.kind !== TRANSFER_KIND) throw new TransferError('broken')
  if (data.v !== TRANSFER_VERSION) throw new TransferError(Number(data.v) > TRANSFER_VERSION ? 'newer' : 'broken')
  if (!Array.isArray(data.lists)) throw new TransferError('broken')
  const lists = sanitizeLists(
    data.lists.map((list) => (list && Array.isArray(list.items) ? { ...list, items: list.items.map(itemFromWire) } : list))
  )
  if (lists.length === 0) throw new TransferError('empty')
  return { lists, exportedAt: typeof data.exportedAt === 'number' ? data.exportedAt : null }
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    throw new TransferError('broken')
  }
}

/** A backup file's text, read. Throws a TransferError. */
export function readBackupFile(text) {
  if (text.length > MAX_TRANSFER_BYTES) throw new TransferError('too-big')
  // Editors that save "UTF-8 with BOM" put one in front.
  return readPayload(parseJson(text.replace(/^\uFEFF/, '')))
}

/** A transfer link's location.hash, read. Throws a TransferError. */
export async function readTransferHash(hash) {
  if (!isTransferHash(hash)) throw new TransferError('broken')
  const encoded = hash.slice(LINK_PREFIX.length)
  const tag = encoded[0]
  if (tag !== 'z' && tag !== 'j') throw new TransferError('broken')
  // Base64 is 4 characters per 3 bytes.
  if (encoded.length > (MAX_TRANSFER_BYTES / 3) * 4) throw new TransferError('too-big')
  let bytes = fromBase64Url(encoded.slice(1))
  if (tag === 'z') {
    if (typeof DecompressionStream !== 'function') throw new TransferError('unsupported')
    bytes = await pipeBytes(bytes, new DecompressionStream('deflate'), MAX_TRANSFER_BYTES)
  }
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new TransferError('broken')
  }
  return readPayload(parseJson(text))
}

/**
 * Whether any item came without names (a link's catalog cards), so the
 * catalog has to be in before they can be filled.
 */
export const needsNames = (lists) =>
  lists.some((list) => list.items.some((item) => !item.nameEn && !item.nameJp && !item.setCode && !item.rarity))

/** `lists` with nameless items given their names from `cardsById`. */
export function fillNames(lists, cardsById) {
  return lists.map((list) => ({
    ...list,
    items: list.items.map((item) => {
      const card = item.nameEn || item.nameJp || item.setCode || item.rarity ? null : cardsById.get(item.id)
      return card
        ? {
            ...item,
            nameEn: card.nameEn || null,
            nameJp: card.nameJp || null,
            setCode: card.setCode || null,
            rarity: card.rarity || null,
          }
        : item
    }),
  }))
}

// --- merging -----------------------------------------------------------------

// Same list, as far as the sheet shows it. Names aren't compared: a link
// leaves them out, and the receiving catalog may have newer ones.
function sameList(a, b) {
  return (
    a.name === b.name &&
    a.pricedAt === b.pricedAt &&
    a.items.length === b.items.length &&
    a.items.every((item, i) => item.id === b.items[i].id && item.qty === b.items[i].qty && item.price === b.items[i].price)
  )
}

/**
 * How importing `incoming` into `local` would go, list by list:
 * { list, status } with status 'new' (added after the lists here), 'update'
 * (replaces an older copy of the same list here), 'same' (already here),
 * 'kept' (the copy here is newer, so it stays) or 'full' (no room left).
 * A list keeps its id wherever it goes, which is how a copy brought back
 * to the browser it came from is recognised.
 */
export function planImport(local, incoming) {
  const here = new Map(local.map((list) => [list.id, list]))
  let room = MAX_LISTS - local.length
  return incoming.map((list) => {
    const mine = here.get(list.id)
    if (!mine) {
      if (room <= 0) return { list, status: 'full' }
      room--
      return { list, status: 'new' }
    }
    if (sameList(mine, list)) return { list, status: 'same' }
    return { list, status: list.updatedAt > mine.updatedAt ? 'update' : 'kept' }
  })
}

/** How many lists in a plan have each status. */
export function countPlan(plan) {
  const counts = { new: 0, update: 0, same: 0, kept: 0, full: 0 }
  for (const { status } of plan) counts[status]++
  return counts
}

/**
 * `local` with `incoming` imported: updated lists stay where they were,
 * new ones go after. Returns { lists, counts, firstId } -- firstId is the
 * first list added or updated (to open), null when nothing changed.
 */
export function mergeLists(local, incoming) {
  const plan = planImport(local, incoming)
  const updates = new Map(plan.filter((p) => p.status === 'update').map((p) => [p.list.id, p.list]))
  const added = plan.filter((p) => p.status === 'new').map((p) => p.list)
  const changed = plan.find((p) => p.status === 'new' || p.status === 'update')
  return {
    lists: [...local.map((list) => updates.get(list.id) || list), ...added],
    counts: countPlan(plan),
    firstId: changed ? changed.list.id : null,
  }
}

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/** What an import did, for the view's notice and the screen reader. */
export function importResultText({ new: added, update, same, kept, full }) {
  const done = []
  if (added) done.push(`Added ${plural(added, 'list', 'lists')}`)
  if (update) done.push(`${done.length ? 'updated' : 'Updated'} ${plural(update, 'list', 'lists')}`)
  const notes = []
  if (same) notes.push(`${plural(same, 'was', 'were')} already here`)
  if (kept) notes.push(`${plural(kept, 'is', 'are')} newer here, so kept`)
  if (full) notes.push(`${full.toLocaleString()} didn’t fit (${MAX_LISTS} lists at most)`)
  const head = done.length ? `${done.join(' and ')}.` : 'Nothing new to import.'
  return notes.length ? `${head} ${notes.join(', ')}.` : head
}

// --- bytes -------------------------------------------------------------------

async function pipeBytes(bytes, transform, limit = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(transform).getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) {
        reader.cancel().catch(() => {})
        throw new TransferError('too-big')
      }
      chunks.push(value)
    }
  } catch (err) {
    // Cut-short or corrupt deflate data.
    throw err instanceof TransferError ? err : new TransferError('broken')
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

function toBase64Url(bytes) {
  let binary = ''
  // In slices, as spreading a few MB into one call overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new TransferError('broken')
  let binary
  try {
    binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    throw new TransferError('broken')
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
