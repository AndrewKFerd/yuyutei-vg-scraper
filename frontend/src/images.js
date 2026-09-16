// yuyu-tei's card CDN serves the same scan at several sizes, addressed only
// by a path segment: /vg/100_140/<set>/<id>.jpg (thumbnail, ~7KB),
// /vg/200_280/... (2x, ~22KB) and /vg/front/... (500x700, ~500KB). The
// dataset stores just the 100_140 URL; these derive the rest so we don't
// carry three URLs per card through a 28k-row JSON file.
//
// Placeholder images (https://card.yuyu-tei.jp/noimage_100_140.jpg) don't
// follow the pattern and are returned unchanged.

const SIZED_PATH = /\/vg\/100_140\//

export function imageUrl2x(url) {
  return url && SIZED_PATH.test(url) ? url.replace(SIZED_PATH, '/vg/200_280/') : null
}

export function imageUrlHd(url) {
  return url && SIZED_PATH.test(url) ? url.replace(SIZED_PATH, '/vg/front/') : null
}
