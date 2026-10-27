// Vercel Function (file-system dynamic route: /api/decklog/<code>) -- reads
// one deck from Bushiroad's Deck Log (decklog.bushiroad.com) for the deck
// importer. Deck Log sends no CORS headers, so the browser can't ask it
// directly; this asks the endpoint Deck Log's own deck page calls, and
// passes on only what the importer needs: each card's number, count, name
// and rarity.
//
// The code is checked before anything leaves this function (a bad one is a
// 400 with no upstream call), only the one fixed host is ever fetched, and
// its answer is read up to MAX_BYTES at most.
import { sendJson } from '../_json.js'

const DECKLOG_ORIGIN = 'https://decklog.bushiroad.com'
const CODE_RE = /^[0-9A-Z]{3,8}$/
const TIMEOUT_MS = 10_000
// A real deck's answer is ~20 KB.
const MAX_BYTES = 512 * 1024
// Deck Log hosts several games' decks; game_title_id 1 is Vanguard.
const VANGUARD = 1
// Deck Log's card lists: the main deck, then the other zones its builder
// keeps apart (G zone, ride deck and the like, depending on the format).
const SECTIONS = ['list', 'sub_list', 'p_list']
const MAX_CARDS = 200
// Decks can be edited, so answers are only briefly cached at the edge.
const DECK_CACHE = 'public, max-age=0, s-maxage=300'
const NOT_FOUND_CACHE = 'public, max-age=0, s-maxage=60'

// Vercel puts the dynamic segment in req.query.code; the vite dev
// middleware does the same. The URL fallback keeps this working if a
// runtime doesn't.
function codeFromRequest(req) {
  let code = req.query?.code
  if (Array.isArray(code)) code = code[0]
  if (code === undefined) {
    const segments = (req.url || '').split('?')[0].split('/').filter(Boolean)
    code = segments.length === 3 && segments[1] === 'decklog' ? segments[2] : ''
  }
  return typeof code === 'string' ? code.toUpperCase() : ''
}

const str = (v) => (typeof v === 'string' && v ? v.slice(0, 200) : null)

/** The importer's view of a Deck Log deck, or null if it isn't one. */
export function trimDeck(code, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const cards = []
  for (const section of SECTIONS) {
    const list = Array.isArray(data[section]) ? data[section] : []
    for (const card of list) {
      const qty = Number(card?.num)
      const number = str(card?.card_number)
      if (!number || !Number.isInteger(qty) || qty < 1 || qty > 99) continue
      cards.push({ code: number, qty, name: str(card.name), rarity: str(card.rare), section })
      if (cards.length >= MAX_CARDS) break
    }
  }
  return { code, title: str(data.title), vanguard: data.game_title_id === VANGUARD, cards }
}

/** The response body as JSON, refusing (and cancelling) one past `maxBytes`. */
export async function readJsonCapped(res, maxBytes = MAX_BYTES) {
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error(`response over ${maxBytes} bytes`)
    }
    chunks.push(value)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function fetchDeck(code) {
  const upstream = await fetch(`${DECKLOG_ORIGIN}/system/app/api/view/${code}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json;charset=utf-8',
      // Deck Log answers its own pages' requests only.
      Referer: `${DECKLOG_ORIGIN}/`,
      'User-Agent': 'yuyutei-vg-scraper deck import',
    },
    body: '{}',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`)
  return readJsonCapped(upstream)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('Allow', 'GET')
    res.end()
    return
  }
  const code = codeFromRequest(req)
  if (!CODE_RE.test(code)) {
    sendJson(res, 400, { error: 'bad-code' })
    return
  }

  let deck
  try {
    // An unknown code comes back as an empty array, which trims to null.
    deck = trimDeck(code, await fetchDeck(code))
  } catch (err) {
    console.error(`[api decklog ${code}] Deck Log request failed:`, err.message)
    sendJson(res, 502, { error: 'upstream' })
    return
  }
  if (!deck) sendJson(res, 404, { error: 'not-found' }, NOT_FOUND_CACHE)
  else if (!deck.vanguard) sendJson(res, 422, { error: 'not-vanguard' }, DECK_CACHE)
  else sendJson(res, 200, { code: deck.code, title: deck.title, cards: deck.cards }, DECK_CACHE)
}
