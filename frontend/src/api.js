/**
 * Fetches the full pre-generated card catalog — every set, tens of
 * thousands of rows — as a static JSON asset served same-origin from
 * `public/data/cards.json` (Vite dev server and any static host in
 * production both serve `public/` at the site root). There's no backend
 * call here anymore: the dataset is built offline and just needs to be
 * downloaded and parsed once on load.
 *
 * @returns {Promise<{generatedAt: string, count: number, cards: Array}>}
 */
export async function fetchCatalog() {
  let response
  try {
    response = await fetch('/data/cards.json')
  } catch (err) {
    throw new Error(`Could not load the card catalog. (${err.message})`)
  }

  if (!response.ok) {
    throw new Error(`Failed to load the card catalog (HTTP ${response.status}).`)
  }

  const data = await response.json()
  if (!data || !Array.isArray(data.cards)) {
    throw new Error('Card catalog response has an unexpected shape.')
  }
  return data
}
