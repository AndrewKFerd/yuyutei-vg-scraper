// Loads a Deck Log deck through api/decklog/[code].js, as decklist lines
// for the importer (see deckText.js for the line shape).

export class DecklogError extends Error {
  /** @param {'not-found' | 'not-vanguard' | 'upstream' | 'network'} code */
  constructor(code) {
    super(code)
    this.code = code
  }
}

const ERROR_CODES = { 404: 'not-found', 422: 'not-vanguard' }

/**
 * @param {string} code  An upper-case Deck Log deck code.
 * @returns {Promise<{ title: string | null, lines: import('./deckText.js').DeckLine[] }>}
 */
export async function fetchDecklog(code) {
  let res
  try {
    res = await fetch(`/api/decklog/${encodeURIComponent(code)}`)
  } catch {
    throw new DecklogError('network')
  }
  if (!res.ok) throw new DecklogError(ERROR_CODES[res.status] || 'upstream')
  let data
  try {
    data = await res.json()
  } catch {
    throw new DecklogError('upstream')
  }
  const cards = Array.isArray(data?.cards) ? data.cards : []
  const lines = cards
    .filter((card) => typeof card?.code === 'string' && Number.isInteger(card.qty))
    .map((card) => ({
      qty: card.qty,
      code: card.code.toUpperCase(),
      name: typeof card.name === 'string' ? card.name : null,
      rarity: typeof card.rarity === 'string' ? card.rarity : null,
      raw: [card.qty, card.code, card.name].filter(Boolean).join(' '),
    }))
  return { title: typeof data?.title === 'string' && data.title ? data.title : null, lines }
}

/** What to tell someone whose Deck Log import didn't work. */
export function decklogErrorText(code, deckCode) {
  switch (code) {
    case 'not-found':
      return `Deck Log has no deck with the code ${deckCode}. Check the code, or paste the card list as text.`
    case 'not-vanguard':
      return `Deck ${deckCode} on Deck Log isn’t a Cardfight!! Vanguard deck.`
    case 'network':
      return 'Couldn’t reach the site. Check your connection and try again.'
    default:
      return 'Couldn’t read the deck from Deck Log just now. Try again, or paste the card list as text.'
  }
}
