'use strict';

/**
 * Builds frontend/src/translate/memory.js, the rules-text translator's
 * memory of real translations:
 *
 *  - lines: whole Japanese ability lines -> their official English, as
 *    templates. A line's one 「name」 becomes {N} and its power-style numbers
 *    (10 and up) {#0}, {#1}..., so "このユニットのパワー＋5000。" also covers
 *    +10000. Small counts stay literal (the English spells them out). When
 *    lines sharing a key disagree, the most common English wins if at least
 *    half agree; otherwise the key is dropped. Only keys that recur (seen on
 *    two or more cards), or that match a line of a card currently showing
 *    only Japanese, are kept: a one-off line almost never comes back, and
 *    keeping them all would cost ~800 KB. Official text only -- the wiki's is
 *    CC BY-SA and isn't shipped.
 *  - fragments: name fragments quoted in "「X」を含む" ("with "Y" in its
 *    card name") -> their English, read off aligned official and wiki lines
 *    where both sides quote the same number of fragments, majority vote.
 *    These are the series names ("ブラスター" -> "Blaster") the catalog's
 *    full-name index can't resolve.
 *
 * Run after scrape-cf-vanguard.js or scrape-fandom.js brings in new text:
 *   node build-translation-memory.js
 * eval-translator.js calls buildMemory({ holdout: true }) to score lines the
 * memory hasn't seen.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { loadPairs } = require('./translation-pairs');
const { writeFileAtomic } = require('./fs-atomic');

const TRANSLATE_DIR = path.join(__dirname, '..', 'frontend', 'src', 'translate');
const OUTPUT_PATH = path.join(TRANSLATE_DIR, 'memory.js');

/** One card in ten, chosen by its key, is held out for evaluation. */
function isHeldOut(key) {
  let h = 7;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 10 === 0;
}

/** English quotes that are names, not granted abilities ('"[AUTO]:..."'). */
function quotedNames(en) {
  return [...en.matchAll(/"([^"[]{1,60})"/g)].map((m) => m[1]);
}

/** The English as a template for its Japanese line, or null when it can't be one. */
function templateFor(jpLine, en) {
  const names = [...jpLine.matchAll(/「([^」]*)」/g)].map((m) => m[1]);
  if (new Set(names).size > 1) return null;
  let template = en;
  if (names.length) {
    const enNames = new Set(quotedNames(en));
    if (enNames.size !== 1) return null;
    const [name] = enNames;
    template = template.split(`"${name}"`).join('"{N}"');
  }
  const numbers = jpLine.match(/\d{2,}/g) || [];
  let from = 0;
  let out = '';
  for (let i = 0; i < numbers.length; i++) {
    const at = template.indexOf(numbers[i], from);
    if (at === -1) return null;
    out += template.slice(from, at) + `{#${i}}`;
    from = at + numbers[i].length;
  }
  return out + template.slice(from);
}

const FRAGMENT_JP = /「([^」]*)」を含む/g;
const FRAGMENT_EN = /"([^"[]{1,60})" in (?:its|their) card names?/g;

async function buildMemory({ holdout = false } = {}) {
  const { normalizeJp } = await import(pathToFileURL(path.join(TRANSLATE_DIR, 'normalize.js')).href);
  const { memoryKey } = await import(pathToFileURL(path.join(TRANSLATE_DIR, 'index.js')).href);
  const { pairs } = loadPairs();

  // Lines of the cards the modal will actually offer to translate.
  const built = require(path.join(__dirname, 'data', 'cards.json'));
  const wanted = new Set();
  for (const card of built.cards || built) {
    if (!card.skillTextJp || card.skillTextEn) continue;
    for (const line of normalizeJp(card.skillTextJp).split('\n')) if (line.trim()) wanted.add(memoryKey(line.trim()));
  }

  const byKey = new Map();
  const votes = new Map();
  for (const p of pairs) {
    if (holdout && isHeldOut(p.key)) continue;
    const jp = normalizeJp(p.jp).trim();

    const jpFragments = [...jp.matchAll(FRAGMENT_JP)].map((m) => m[1]);
    const enFragments = [...p.en.matchAll(FRAGMENT_EN)].map((m) => m[1]);
    if (jpFragments.length && jpFragments.length === enFragments.length) {
      jpFragments.forEach((x, i) => {
        if (!/[぀-ヿ㐀-鿿]/.test(x)) return;
        const v = votes.get(x) || new Map();
        v.set(enFragments[i], (v.get(enFragments[i]) || 0) + 1);
        votes.set(x, v);
      });
    }

    if (p.source !== 'official') continue;
    const template = templateFor(jp, p.en);
    if (!template) continue;
    const key = memoryKey(jp);
    const t = byKey.get(key) || new Map();
    t.set(template, (t.get(template) || 0) + 1);
    byKey.set(key, t);
  }

  const lines = {};
  for (const [key, templates] of [...byKey].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const total = [...templates.values()].reduce((a, b) => a + b, 0);
    if (total < 2 && !wanted.has(key)) continue;
    const [best, n] = [...templates].sort((a, b) => b[1] - a[1])[0];
    if (n * 2 >= total) lines[key] = best;
  }
  const fragments = {};
  for (const [jp, v] of [...votes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const total = [...v.values()].reduce((a, b) => a + b, 0);
    const [best, n] = [...v].sort((a, b) => b[1] - a[1])[0];
    if (n * 2 > total) fragments[jp] = best;
  }
  return { lines, fragments };
}

async function main() {
  const memory = await buildMemory();
  const body =
    '// Generated by pipeline/build-translation-memory.js -- do not edit.\n' +
    '// Ability lines: official English (en.cf-vanguard.com). Name fragments:\n' +
    '// official English and the Cardfight!! Vanguard Wiki.\n' +
    `export default ${JSON.stringify(memory, null, 1)}\n`;
  writeFileAtomic(OUTPUT_PATH, body);
  console.log(`Wrote ${OUTPUT_PATH}: ${Object.keys(memory.lines).length} lines, ${Object.keys(memory.fragments).length} fragments, ${(Buffer.byteLength(body) / 1024).toFixed(0)} KB`);
}

module.exports = { buildMemory, isHeldOut, templateFor };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
