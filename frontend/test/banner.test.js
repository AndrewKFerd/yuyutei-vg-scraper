// The banner collage's card picks (src/lib/banner.js).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { bannerImageUrls } from '../src/lib/banner.js'

const card = (id, rarity, nameEn, setSlug = 'dzbt17') => ({
  id,
  rarity,
  nameEn,
  setSlug,
  setCode: `DZ-BT17/${id}`,
  imageUrl: `https://card.yuyu-tei.jp/vg/100_140/${id}.jpg`,
})

describe('bannerImageUrls', () => {
  it('takes the set’s showpiece prints, rarest first, one per name, as 2x scans', () => {
    const urls = bannerImageUrls([
      card('a1', 'FFR', 'Seza'),
      card('a2', 'SEC', 'Seza'),
      card('a3', 'C', 'Grunt'),
      card('a4', 'SR', 'Ima'),
      card('b1', 'SEC', 'Other set', 'dzbt16'),
      card('a5', 'DSR', 'Rezael'),
    ])
    assert.deepEqual(urls, [
      'https://card.yuyu-tei.jp/vg/200_280/a2.jpg',
      'https://card.yuyu-tei.jp/vg/200_280/a5.jpg',
      'https://card.yuyu-tei.jp/vg/200_280/a4.jpg',
    ])
  })

  it('stops at the maximum', () => {
    const cards = Array.from({ length: 10 }, (_, i) => card(`c${i}`, 'SR', `Card ${i}`))
    assert.equal(bannerImageUrls(cards, { max: 4 }).length, 4)
  })

  it('is empty before the catalog has the set', () => {
    assert.deepEqual(bannerImageUrls([]), [])
  })
})
