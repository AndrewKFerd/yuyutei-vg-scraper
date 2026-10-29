// Which cards make up the banner's collage (app/BannerCollage.jsx): the
// showpiece prints of one set -- DZ-BT17 "運命星戦" -- one per card name,
// rarest printing first, as 200x280 scans.
import { imageUrl2x } from './images.js'

export const BANNER_SET = 'dzbt17'
export const BANNER_MAX_CARDS = 28

// Rarest first; anything else in the set isn't used.
const RARITY_ORDER = ['SEC', 'DSR', 'SIR+', 'FFR', 'SR']

/**
 * @param {import('./types.js').Card[]} cards the loaded catalog
 * @returns {string[]} image URLs, at most BANNER_MAX_CARDS
 */
export function bannerImageUrls(cards, { set = BANNER_SET, max = BANNER_MAX_CARDS } = {}) {
  const rank = (card) => RARITY_ORDER.indexOf(card.rarity)
  const picked = cards
    .filter((card) => card.setSlug === set && rank(card) !== -1 && card.imageUrl)
    .sort((a, b) => rank(a) - rank(b) || a.setCode.localeCompare(b.setCode))
  const seen = new Set()
  const urls = []
  for (const card of picked) {
    const name = card.nameEn || card.nameJp
    if (seen.has(name)) continue
    seen.add(name)
    const url = imageUrl2x(card.imageUrl)
    if (url) urls.push(url)
    if (urls.length === max) break
  }
  return urls
}
