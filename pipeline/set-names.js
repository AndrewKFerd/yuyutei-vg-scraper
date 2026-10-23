'use strict';

/**
 * Hand-written English names for whole sets the official database and the
 * Cardfight!! Vanguard Wiki don't cover yet (data/set-names.json), for
 * build-data.js to use ahead of the machine translator.
 *
 * Unlike the glossary's fixedPhrases, which rewrite every name in the catalog,
 * an entry here only ever names a card of its own set: a collab set's arcana
 * card "月" must not turn every other card's 月 into "Moon".
 *
 * A listing matches its exact Japanese name, or the longest entry it starts
 * with when the rest is a parenthesized variant marker ("イオ(箔押し)" ->
 * "Io (Foil Stamping)"); the marker goes through the translator. card-group's
 * baseName can't be used to find the entry, since it would strip parts of
 * the name itself ("オルフェウス(男性型)", "主人公(P1)").
 */

const fs = require('fs');
const path = require('path');
const { translateCardName } = require('./translate-engine');

const SET_NAMES_PATH = path.join(__dirname, 'data', 'set-names.json');

let _cache = null;

/** set code -> { names, keys longest first } */
function load() {
  if (_cache) return _cache;
  const data = JSON.parse(fs.readFileSync(SET_NAMES_PATH, 'utf8'));
  _cache = new Map();
  for (const [setCode, names] of Object.entries(data)) {
    if (setCode.startsWith('_')) continue;
    _cache.set(setCode, { names, keys: Object.keys(names).sort((a, b) => b.length - a.length) });
  }
  return _cache;
}

/** The card's hand-written English name, or null when its set has no entry for it. */
function findSetName(setCode, nameJp) {
  const set = load().get(String(setCode || '').split('/')[0]);
  if (!set || !nameJp) return null;
  if (Object.hasOwn(set.names, nameJp)) return set.names[nameJp];
  const key = set.keys.find((k) => nameJp.startsWith(k) && /^\s*[(（]/.test(nameJp.slice(k.length)));
  if (!key) return null;
  return `${set.names[key]} ${translateCardName(nameJp.slice(key.length).trim()).nameEn}`;
}

module.exports = { findSetName };
