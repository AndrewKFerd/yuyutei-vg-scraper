// Rules-based, fully local Japanese -> English translation of a card's rules
// text, for cards with no official or wiki English yet. Loaded on demand by
// the card modal (useRulesTranslation.js), so none of it is in the main
// bundle. Pure functions with no browser APIs: pipeline/test and
// pipeline/eval-translator.js run the same code.

import { normalizeJp } from './normalize.js'
import { Context, translateLine } from './grammar.js'
import { buildNameIndex } from './context.js'
import memory from './memory.js'

export { buildNameIndex }
export { translateTerm } from './terms.js'

const JAPANESE_CHAR = /[぀-ヿ㐀-鿿]/g
// A run of untranslated Japanese, including the punctuation and short ASCII
// bits (digits, circle markers) sitting between its characters.
const JAPANESE_RUN = /[「『【《〈(]*[぀-ヿ㐀-鿿](?:[぀-ヿ㐀-鿿「」『』【】《》〈〉、。・]|[\d+\-/]+(?=[぀-ヿ㐀-鿿「【])|\((?:VC|RC|GC|\d+)\)(?=[぀-ヿ㐀-鿿「【]))*[」』】》〉)]*/g

/** "DZ-BT01/001" -> "DZ"; unprefixed codes are the original series. */
export function eraOf(setCode) {
  const m = /^([A-Za-z]+)-/.exec(String(setCode || '').split('/')[0])
  return m ? m[1].toUpperCase() : 'legacy'
}

/**
 * The official text writes "[Power] +5000" up to DZ-BT07 and "[Power]+5000"
 * from DZ-BT08 on ("drive +1" and "grade +1" keep their space either way).
 * DZ products past BT07 that the official site doesn't list yet (SS, LBT,
 * promos...) will get the current style when they're translated.
 */
export function tightStats(setCode) {
  const code = String(setCode || '').split('/')[0].toUpperCase()
  if (!code.startsWith('DZ-')) return false
  const m = /^DZ-(BT|TD)(\d+)/.exec(code)
  return !(m && (m[1] === 'TD' || Number(m[2]) < 8))
}

function statStyle(text, tight) {
  return tight ? text.replace(/\[(Power|Critical|Shield)\] ([+-]\d)/g, '[$1]$2') : text.replace(/\[(Power|Critical|Shield)\]([+-]\d)/g, '[$1] $2')
}

function countJapanese(text) {
  return (text.match(JAPANESE_CHAR) || []).length
}

/** The text split into translated and still-Japanese runs. */
export function segmentsOf(text) {
  const segments = []
  let last = 0
  for (const m of text.matchAll(JAPANESE_RUN)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), untranslated: false })
    segments.push({ text: m[0], untranslated: true })
    last = m.index + m[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last), untranslated: false })
  return segments
}

// Line memory: whole ability lines seen with an official translation (see
// pipeline/build-translation-memory.js). The key generalizes a line's single
// 「name」 and its power-style numbers (10 and up); small counts stay literal,
// since the English spells them out ("a card", "two cards").
export function memoryKey(line) {
  return line.replace(/「[^」]*」/g, '「N」').replace(/\d{2,}/g, '#')
}

function fromMemory(line, ctx, mem) {
  const template = mem.lines[memoryKey(line)]
  if (!template) return null
  const names = [...line.matchAll(/「([^」]*)」/g)].map((m) => m[1])
  if (new Set(names).size > 1) return null
  const numbers = line.match(/\d{2,}/g) || []
  return template
    .replace(/\{N\}/g, () => ctx.name(names[0], { fragment: true }).replace(/^"|"$/g, ''))
    .replace(/\{#(\d+)\}/g, (_, i) => numbers[Number(i)])
}

/**
 * Translates a card's Japanese rules text.
 *
 * `card`: { setCode, nameJp, nameEn } of the card itself (its own name in
 * 「」 becomes its English name). `names`: buildNameIndex() of the catalog.
 * Returns { text, segments, coverage }: coverage is the share of the
 * Japanese that was translated (0-1). `memory` is for the evaluation script.
 */
export function translateRules(textJp, { card = {}, names = null, memory: mem = memory } = {}) {
  const normalized = normalizeJp(textJp)
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean)
  const tight = tightStats(card.setCode)
  const out = lines.map((line) => {
    const ctx = new Context({
      era: eraOf(card.setCode),
      selfJp: card.nameJp ? normalizeJp(card.nameJp) : null,
      selfEn: card.nameEn || null,
      names,
      fragments: mem.fragments,
    })
    return statStyle(fromMemory(line, ctx, mem) ?? translateLine(line, ctx), tight)
  })
  const text = out.join('\n')
  const before = countJapanese(normalized)
  return {
    text,
    segments: segmentsOf(text),
    coverage: before ? 1 - Math.min(1, countJapanese(text) / before) : 1,
  }
}
