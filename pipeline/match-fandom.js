'use strict';

/**
 * Looks up a yuyu-tei D-/DZ- card in the Cardfight!! Vanguard Fandom wiki
 * scrape (data/fandom-raw.json, from scrape-fandom.js) for a fan-translated
 * English name and card text. build-data.js only consults this when
 * match-official.js found no official English release.
 *
 * Matching, most to least reliable:
 *  1. Card code -- each wiki page lists every Japanese printing's code
 *     ("DZ-BT17/001", "DZ-BT17/SEC01", "D-PR/756"), so an exact hit is
 *     unambiguous.
 *  2. Japanese name -- for printings the wiki doesn't list (yuyu-tei's own
 *     variant codes, newer reprints), the card's base name (variant markers
 *     like "(箔押し)" stripped) against the page's kanji/kana name. Many
 *     names cover several different cards (four Chronojet Dragons), so a
 *     name shared by multiple pages only matches if exactly one of them
 *     lists a printing from the same set ("DZ-SS16/15thSP05" -> the page
 *     listing DZ-SS16 codes); otherwise it's left unmatched.
 */

const fs = require('fs');
const path = require('path');
const { baseName } = require('./card-group');

const RAW_DATA_PATH = path.join(__dirname, 'data', 'fandom-raw.json');
const D_ERA_SET_RE = /^DZ?-/i;

let cachedIndex = null;

/** Ignores width, spacing and quote-style differences between the two sites. */
function normalizeName(name) {
  return (name || '').normalize('NFKC').replace(/[\s"'“”‘’「」『』]/g, '');
}

function buildIndex() {
  const byCode = new Map();
  const byName = new Map();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(RAW_DATA_PATH, 'utf8'));
  } catch (err) {
    console.warn(`[match-fandom] Could not read ${RAW_DATA_PATH} (${err.message}). Run scrape-fandom.js for fan translations; all lookups will return null.`);
    return { byCode, byName };
  }

  for (const card of raw.cards || []) {
    for (const code of card.codes || []) {
      if (!byCode.has(code)) byCode.set(code, card);
    }
    const key = normalizeName(card.kanji);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(card);
  }
  return { byCode, byName };
}

function setOf(code) {
  return code.split('/')[0];
}

function matchByName(setCode, nameJp) {
  const candidates = cachedIndex.byName.get(normalizeName(baseName(nameJp)));
  if (!candidates) return null;
  if (candidates.length === 1) return candidates[0];
  const set = setOf(setCode);
  const sameSet = candidates.filter((c) => c.codes.some((code) => setOf(code) === set));
  return sameSet.length === 1 ? sameSet[0] : null;
}

/**
 * @param {string} setCode yuyu-tei JP set code, e.g. "DZ-BT17/001"
 * @param {string} nameJp  yuyu-tei JP card name
 * @returns {{title: string, nameEn: string, effect: ?string, flavor: ?string,
 *   grade: ?number, power: ?number, shield: ?number, nation: ?string} | null}
 */
function findFandomCard(setCode, nameJp) {
  if (!setCode || !D_ERA_SET_RE.test(setCode)) return null;
  cachedIndex ??= buildIndex();
  const code = setCode.trim().toUpperCase();
  return cachedIndex.byCode.get(code) || matchByName(code, nameJp);
}

module.exports = { findFandomCard };
