// Base URL of the backend API. Falls back to the local dev backend when the
// env var isn't set (e.g. running the built bundle without a .env file).
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

/**
 * Fetches the full card list for a given set code from the backend.
 * The backend caches per-set results, so we only need to call this once
 * per set (on mount) and do all filtering client-side afterwards.
 *
 * @param {string} setCode e.g. "dzbt16"
 * @returns {Promise<{set: string, setNameJp: string, count: number, cachedAt: string, cards: Array}>}
 */
export async function fetchCards(setCode) {
  const url = `${API_URL}/api/cards?set=${encodeURIComponent(setCode)}`
  let response
  try {
    response = await fetch(url)
  } catch (err) {
    throw new Error(
      `Could not reach the backend at ${API_URL}. Is it running? (${err.message})`
    )
  }

  if (!response.ok) {
    throw new Error(`Backend returned an error (HTTP ${response.status}).`)
  }

  const data = await response.json()
  if (!data || !Array.isArray(data.cards)) {
    throw new Error('Backend returned an unexpected response shape.')
  }
  return data
}
