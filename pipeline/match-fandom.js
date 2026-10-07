'use strict';

/**
 * Looks up a yuyu-tei card in the Cardfight!! Vanguard Fandom wiki scrape
 * (data/fandom-raw.json, from scrape-fandom.js) for a fan-translated English
 * name and card text. Covers every series the scrape does (D-/DZ-, V-, G- and
 * the unprefixed older sets, see fandom-series.js). build-data.js only
 * consults this when match-official.js found no official English release.
 *
 * Matching, most to least reliable:
 *  1. Card code -- each wiki page lists every Japanese printing's code
 *     ("DZ-BT17/001", "V-EB05/SSP01", "G-BT01/001", "BT01/S02", "D-PR/756"),
 *     so an exact hit is unambiguous.
 *  2. Japanese name -- for printings the wiki doesn't list (yuyu-tei's own
 *     variant codes, newer reprints), the card's base name (variant markers
 *     like "(箔押し)" stripped) against the page's kanji/kana name. Only pages
 *     that list a printing in the same series family as the card count
 *     (D-/DZ- together; V-, G- and older sets each on their own), so a
 *     V-era card is never matched to an unrelated D-era card that happens to
 *     share its name. Many names cover several different cards (four
 *     Chronojet Dragons), so a name shared by multiple pages only matches if
 *     exactly one of them lists a printing from the same set ("DZ-SS16/
 *     15thSP05" -> the page listing DZ-SS16 codes); otherwise it's left
 *     unmatched.
 */

const fs = require('fs');
const path = require('path');
const { baseName } = require('./card-group');
const { familyOfCode } = require('./fandom-series');

const RAW_DATA_PATH = path.join(__dirname, 'data', 'fandom-raw.json');

/** Ignores width, spacing and quote-style differences between the two sites. */
function normalizeName(name) {
  return (name || '').normalize('NFKC').replace(/[\s"'“”‘’「」『』]/g, '');
}

function setOf(code) {
  return code.split('/')[0];
}

/**
 * A lookup function over a parsed fandom-raw.json ({ cards: [...] }); `raw`
 * may be null/empty (then every lookup is null).
 */
function createMatcher(raw) {
  const byCode = new Map();
  const byName = new Map();
  for (const card of raw?.cards || []) {
    for (const code of card.codes || []) {
      if (!byCode.has(code)) byCode.set(code, card);
    }
    const key = normalizeName(card.kanji);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(card);
  }

  function matchByName(code, nameJp) {
    const all = byName.get(normalizeName(baseName(nameJp)));
    if (!all) return null;
    const family = familyOfCode(code);
    const candidates = all.filter((c) => (c.codes || []).some((k) => familyOfCode(k) === family));
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    const set = setOf(code);
    const sameSet = candidates.filter((c) => c.codes.some((k) => setOf(k) === set));
    return sameSet.length === 1 ? sameSet[0] : null;
  }

  return function find(setCode, nameJp) {
    if (!setCode) return null;
    const code = setCode.trim().toUpperCase();
    // A code with no supported series prefix (e.g. "VG-...") has no wiki data.
    if (!familyOfCode(code)) return null;
    return byCode.get(code) || matchByName(code, nameJp);
  };
}

let cachedMatcher = null;

function loadMatcher() {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(RAW_DATA_PATH, 'utf8'));
  } catch (err) {
    console.warn(`[match-fandom] Could not read ${RAW_DATA_PATH} (${err.message}). Run scrape-fandom.js for fan translations; all lookups will return null.`);
  }
  return createMatcher(raw);
}

/**
 * @param {string} setCode yuyu-tei JP set code, e.g. "DZ-BT17/001", "G-BT01/001"
 * @param {string} nameJp  yuyu-tei JP card name
 * @returns {{title: string, nameEn: string, effect: ?string, flavor: ?string,
 *   grade: ?number, power: ?number, shield: ?number, nation: ?string} | null}
 */
function findFandomCard(setCode, nameJp) {
  cachedMatcher ??= loadMatcher();
  return cachedMatcher(setCode, nameJp);
}

module.exports = { findFandomCard, createMatcher };
