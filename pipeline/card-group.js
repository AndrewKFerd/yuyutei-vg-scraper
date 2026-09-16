'use strict';

/**
 * Identity key for "the same card" across its listings. yuyu-tei lists every
 * foil/parallel/signed variant separately (28k listings), but rules text,
 * stats and flavor are identical across them -- only the printing differs.
 * Grouping them lets scrape-card-detail.js fetch one page per card (~17k)
 * instead of one per listing, and build-data.js copy the result to every
 * variant.
 *
 * Key = <era>|<base name>:
 *  - era: the set code's letter prefix before the dash ("DZ-BT16/SEC01" ->
 *    "DZ", "V-BT04/043" -> "V"). Same-named cards from different eras
 *    (V-series vs D-series "Blaster Blade") are genuinely different cards
 *    with different text, so they must not share a group. Codes with no
 *    dash prefix (original-era "BT01/001", "TD14/004PR") fall under
 *    "legacy".
 *  - base name: nameJp with trailing parenthesized variant markers removed
 *    -- "(箔押し)" foil, "(RRR仕様)" print grade, "(サイン入り)" signed, etc.
 */

const VARIANT_SUFFIX_RE = /(\s*[(（][^()（）]*[)）])+\s*$/;

function baseName(nameJp) {
  return (nameJp || '').replace(VARIANT_SUFFIX_RE, '').trim();
}

function era(setCode) {
  const m = (setCode || '').split('/')[0].match(/^([A-Za-z]+)-/);
  return m ? m[1].toUpperCase() : 'legacy';
}

function groupKey(card) {
  return `${era(card.setCode)}|${baseName(card.nameJp)}`;
}

/** True if this listing is the plainest printing (no variant marker) -- preferred as the group's representative. */
function isPlainPrinting(card) {
  return !VARIANT_SUFFIX_RE.test(card.nameJp || '');
}

module.exports = { groupKey, baseName, era, isPlainPrinting };
