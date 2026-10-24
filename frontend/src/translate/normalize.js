// Puts yuyu-tei's Japanese rules text into one spelling before the grammar
// reads it. The shop mixes full- and half-width forms freely ("ターン１回" /
// "ターン1回", "（" / "("), so digits, Latin letters and ASCII-range
// punctuation are folded to half-width. Japanese punctuation (、。「」『』
// 【】《》) is left alone: the grammar splits on it.

const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2212\uFF0D]/g

// The scrape lost some glyphs to "?": usually the ＋ of a stat modifier
// ("クリティカル?２", "ドライブ?１", "パワー?5000"). Only those positions are
// repaired -- a "?" inside a name ("ファウスト?世") is left as it is.
const LOST_PLUS = /(パワー|クリティカル|シールド|ドライブ|グレード)\?(?=[0-9０-９])/g

export function normalizeJp(text) {
  return String(text || '')
    .replace(LOST_PLUS, '$1\uFF0B')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(DASHES, '-')
    .replace(/\r\n?/g, '\n')
}
