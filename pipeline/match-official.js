'use strict';

/**
 * Conservative matcher: given a yuyu-tei (Japanese) card's `setCode` and
 * `nameJp`, tries to find a confident official English name from the
 * cf-vanguard.com scrape (data/cf-vanguard-raw.json).
 *
 * ## What we verified (full write-up in CF_VANGUARD_NOTES.md)
 *
 * cf-vanguard.com's English card database has NO Japanese-name field, so
 * there is no way to match on name directly. The only usable signal is the
 * card code. We tested the hypothesis suggested in the task — "strip the
 * leading Z from `DZ-BTxx` to get `D-BTxx` and match numbers" — against real
 * scraped data from both sides and it is WRONG: `DZ-BT01` (Japanese, the
 * current "Divinez" era) and `D-BT01` (Japanese, the older "Will+Dress /
 * overDress" era) are two entirely different, unrelated card sets that just
 * happen to reuse the number "01". E.g. Japanese `D-BT01/DSR01` is "Trickstar"
 * while Japanese `DZ-BT01/DSR01` is "Rezael, the Miracle Fated One" (well
 * inaccurately, whatever it romanizes to) — completely different cards.
 * Stripping the Z would have paired those two together as a false "match".
 *
 * The actual rule that DOES hold, verified against real data on both sides:
 *   yuyu-tei's JP setCode, taken EXACTLY as-is (no transformation), plus the
 *   literal suffix "EN", equals cf-vanguard's card code, whenever that exact
 *   card has been released in English.
 *
 * Examples that verify this (see CF_VANGUARD_NOTES.md for more):
 *   JP D-BT01/001            "ヴェルリーナ・バリエンテ"
 *   EN D-BT01/001EN          "Vairina Valiente"                    -> MATCH
 *   JP D-BT01/DSR01          "トリクスタ(箔押し)"
 *   EN D-BT01/DSR01EN        "Trickstar"                            -> MATCH
 *   JP DZ-BT01/001           "無双の運命者 ヴァルガ・ドラグレス"
 *   EN DZ-BT01/001EN         "Fated One of Unparalleled, Varga Dragres" -> MATCH
 *   JP DZ-BT01/019           "再起の竜神王 ドラグヴェーダ"
 *   EN DZ-BT01/019EN         "Dragon Deity King of Resurgence, Dragveda" -> MATCH
 *
 * This rule is ONLY verified for the `D-BTxx` and `DZ-BTxx` booster-set
 * families. We have NOT verified it for structure/trial decks (D-SD, D-TD,
 * DZ-TD — different products sometimes reprint cards under different
 * per-product numbering) or any promo/event code, so this matcher refuses to
 * match those families even if data for them exists in the raw scrape.
 *
 * The other, larger reason most lookups will legitimately return null: the
 * English release lags Japan by one or more full sets. As of this scrape,
 * Japan is up to DZ-BT16 while English tops out at DZ-BT15 — so an entire
 * current-format set (and everything newer) has NO English release yet, and
 * every card in it will correctly get "no match" from this matcher. That is
 * expected, not a bug.
 *
 * `nameJp` is accepted for interface completeness (and so callers don't have
 * to special-case this function) but is NOT currently used to verify a
 * match: cf-vanguard has no Japanese text to compare it against, and we
 * deliberately do not attempt machine transliteration/back-translation here
 * to avoid manufacturing false confidence — that's the translation engine's
 * job, not this module's.
 *
 * Usage:
 *   const { findOfficialName } = require('./match-official');
 *   findOfficialName('DZ-BT01/001', '無双の運命者 ヴァルガ・ドラグレス')
 *   // -> { nameEn: 'Fated One of Unparalleled, Varga Dragres', confidence: 'high', cfCode: 'DZ-BT01/001EN' }
 *   findOfficialName('DZ-BT16/SEC01', '月華忍姫 リシアフェール...')
 *   // -> null (DZ-BT16 not released in English yet)
 */

const fs = require('fs');
const path = require('path');

const RAW_DATA_PATH = path.join(__dirname, 'data', 'cf-vanguard-raw.json');

// Only these JP set-code family prefixes have verified 1:1 code correlation
// with cf-vanguard's English codes. Anything else (structure decks, trial
// decks, promo codes, or a family we haven't checked) returns null rather
// than guessing.
const VERIFIED_FAMILY_RE = /^(DZ|D)-BT\d{2,}$/i;

let cachedIndex = null;

function stripEnSuffix(cfCode) {
  // "D-BT01/001EN" -> "D-BT01/001", "D-BT01/DSR01EN" -> "D-BT01/DSR01"
  // Leaves anything odd (e.g. a "-R"/"-T" reprint-variant suffix seen on
  // structure-deck codes) alone rather than guessing how to normalize it.
  return cfCode.replace(/EN$/i, '');
}

function buildIndex() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(RAW_DATA_PATH, 'utf8'));
  } catch (err) {
    console.warn(`[match-official] Could not read ${RAW_DATA_PATH} (${err.message}). All lookups will return null.`);
    return new Map();
  }

  const index = new Map();
  for (const card of raw.cards || []) {
    if (!card || !card.cfCode || !card.nameEn) continue;
    const jpEquivalentCode = stripEnSuffix(card.cfCode).toUpperCase();
    // First one wins; in practice cfCode is unique per scrape so this is
    // just a safety net against duplicate entries.
    if (!index.has(jpEquivalentCode)) {
      index.set(jpEquivalentCode, card);
    }
  }
  return index;
}

function getIndex() {
  if (!cachedIndex) cachedIndex = buildIndex();
  return cachedIndex;
}

/** Test-only hook: force a rebuild on the next getIndex() call (e.g. after
 * re-running the scraper mid-process). Not needed in normal operation. */
function invalidateCache() {
  cachedIndex = null;
}

/**
 * @param {string} setCode  yuyu-tei JP set code, e.g. "DZ-BT16/SEC01"
 * @param {string} nameJp   yuyu-tei JP card name (accepted, not currently used — see file header)
 * @returns {{nameEn: string, confidence: 'high', cfCode: string} | null} 'medium' was
 *   considered (e.g. guessing foil-parallel<->base-card correspondence by number) but
 *   dropped as unsafe once checked against real data — see file header — so this only
 *   ever returns 'high' or null.
 */
function findOfficialName(setCode, nameJp) {
  if (!setCode || typeof setCode !== 'string') return null;

  const normalized = setCode.trim().toUpperCase();
  const slashIdx = normalized.indexOf('/');
  if (slashIdx === -1) return null;

  const setPart = normalized.slice(0, slashIdx);
  if (!VERIFIED_FAMILY_RE.test(setPart)) return null;

  const index = getIndex();
  const hit = index.get(normalized);
  if (!hit) return null;

  return {
    nameEn: hit.nameEn,
    confidence: 'high',
    cfCode: hit.cfCode,
  };
}

module.exports = { findOfficialName, invalidateCache, VERIFIED_FAMILY_RE };
