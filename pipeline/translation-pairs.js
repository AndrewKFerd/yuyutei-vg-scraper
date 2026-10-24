'use strict';

/**
 * Japanese ability lines paired with their English, for the rules-text
 * translator (frontend/src/translate): build-translation-memory.js learns
 * from the official pairs, eval-translator.js scores against both kinds.
 *
 * Cards are joined the way build-data.js joins them: each catalog listing's
 * detail entry (card-group.js key) gives the Japanese text, the official
 * English database (match-official.js) or the wiki (match-fandom.js) the
 * English. One pair set per card, not per listing. A card's lines are only
 * used when both sides have the same number of abilities -- then line i
 * translates line i.
 */

const path = require('path');
const { groupKey } = require('./card-group');
const { findOfficialName } = require('./match-official');
const { findFandomCard } = require('./match-fandom');

const DATA = path.join(__dirname, 'data');

/**
 * English ability text split into abilities. cf-vanguard delivers one
 * run-on line; a new ability starts at each [AUTO]/[CONT]/[ACT] icon that
 * isn't inside a granted ability's quotes ('gets "[AUTO]:..."').
 */
function splitEnglishAbilities(text) {
  const lines = [];
  for (const raw of String(text || '').split('\n')) {
    let cur = '';
    let quoted = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '"') quoted = !quoted;
      if (!quoted && cur.trim() && /^\[(?:CONT|ACT|AUTO)\]/.test(raw.slice(i))) {
        lines.push(cur.trim());
        cur = '';
      }
      cur += ch;
    }
    if (cur.trim()) lines.push(cur.trim());
  }
  return lines;
}

function splitJapanese(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * [{ key, setCode, nameJp, nameEn, source: 'official'|'fandom', jp, en }]
 * for every aligned line. `sources` picks which English to pair with.
 */
function loadPairs({ sources = ['official', 'fandom'] } = {}) {
  const raw = require(path.join(DATA, 'catalog-raw.json'));
  const skills = require(path.join(DATA, 'card-details-raw.json')).skills;
  const seen = new Set();
  const pairs = [];
  const stats = { cards: 0, aligned: 0 };
  for (const card of raw.cards) {
    const key = groupKey(card);
    if (seen.has(key)) continue;
    const detail = skills[key];
    if (!detail || !detail.effect) continue;
    const jp = splitJapanese(detail.effect);
    for (const source of sources) {
      const match = source === 'official' ? findOfficialName(card.setCode, card.nameJp) : findFandomCard(card.setCode, card.nameJp);
      const text = match && (source === 'official' ? match.skillText : match.effect);
      if (!text) continue;
      seen.add(key);
      stats.cards++;
      const en = splitEnglishAbilities(text);
      if (en.length !== jp.length) continue;
      stats.aligned++;
      jp.forEach((line, i) => pairs.push({ key, setCode: card.setCode, nameJp: card.nameJp, nameEn: match.nameEn, source, jp: line, en: en[i] }));
    }
  }
  return { pairs, stats };
}

module.exports = { loadPairs, splitEnglishAbilities };
