'use strict';

/**
 * translate-engine.js
 *
 * A pure, synchronous, zero-network JA -> EN translator for Cardfight!! Vanguard
 * card names, built from a hand-authored glossary (pipeline/data/glossary.json)
 * plus mechanical Hepburn romanization of any kana that isn't covered by the
 * glossary.
 *
 * No external translation API/service is called at any point. Everything here
 * is deterministic string processing over data loaded once from disk.
 *
 * Algorithm (see pipeline/data/glossary.json's _comment for the data shape):
 *   1. Load the glossary once (module-scope cache).
 *   2. Replace every `fixedPhrases` match in the whole string first (exact
 *      substring, longest key first, ALL occurrences).
 *   3. Walk what's left left-to-right. At each position:
 *      a. If the character is a kanji, try the longest `compounds` key that
 *         starts at this position (compound keys are checked longest-first).
 *      b. Otherwise fall back to a single-character `kanji` lookup.
 *      c. If the character is kana (hiragana/katakana), consume the whole
 *         contiguous kana run and romanize it (Hepburn) as one unit.
 *      d. Anything else (ASCII, already-Latin text, punctuation, quotes,
 *         parens...) passes through unchanged, except a small set of
 *         full-width punctuation marks which get normalized to their ASCII
 *         equivalents for readability.
 *   4. Join translated "word" segments (compound/kanji/romaji hits) with a
 *      single space between adjacent words; passthrough text (including any
 *      whitespace/punctuation that was already in the source) is spliced in
 *      untouched, so quotes/parens stay attached to what they wrap.
 *   5. Classify how the name was resolved as 'glossary' | 'romaji' | 'mixed' |
 *      'passthrough'.
 *
 * This is intentionally approximate — compositional translation of stylized
 * card names can never be perfect. The bar is "readable and useful for an
 * English speaker searching/skimming", not professional localization.
 */

const fs = require('fs');
const path = require('path');

const GLOSSARY_PATH = path.join(__dirname, 'data', 'glossary.json');

// ---------------------------------------------------------------------------
// Glossary loading (cached in module scope)
// ---------------------------------------------------------------------------

let _glossaryCache = null;

function loadGlossary() {
  if (_glossaryCache) return _glossaryCache;

  const raw = fs.readFileSync(GLOSSARY_PATH, 'utf8');
  const data = JSON.parse(raw);

  const fixedPhrases = data.fixedPhrases || {};
  const compounds = data.compounds || {};
  const kanji = data.kanji || {};

  // Longest-key-first so greedy matching always prefers the most specific entry.
  const fixedPhraseKeys = Object.keys(fixedPhrases).sort((a, b) => b.length - a.length);
  const compoundKeys = Object.keys(compounds).sort((a, b) => b.length - a.length);

  _glossaryCache = { fixedPhrases, compounds, kanji, fixedPhraseKeys, compoundKeys };
  return _glossaryCache;
}

/** Test-only escape hatch: force a reload next time loadGlossary() is called. */
function _resetGlossaryCache() {
  _glossaryCache = null;
}

// ---------------------------------------------------------------------------
// Character classification
// ---------------------------------------------------------------------------

// CJK Unified Ideographs + Extension A. Covers essentially every kanji that
// could plausibly appear in a Vanguard card name.
function isKanji(ch) {
  const code = ch.codePointAt(0);
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
}

// Hiragana (U+3040-U+309F) or katakana (U+30A0-U+30FF), per spec, minus a
// handful of codepoints in that range that are punctuation/marks rather than
// morae (middle dot, iteration marks, the rare katakana-hiragana prolonged
// double hyphen) so they fall through to plain passthrough instead of being
// swallowed into a "kana run".
const KANA_NON_MORA = new Set([0x30a0, 0x30fb, 0x30fd, 0x30fe, 0x30ff]);

function isKana(ch) {
  const code = ch.codePointAt(0);
  if (KANA_NON_MORA.has(code)) return false;
  return (code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff);
}

// Hiragana and katakana occupy parallel blocks offset by exactly 0x60
// (e.g. あ U+3042 -> ア U+30A2), so every lookup table below is keyed by
// katakana and hiragana input is normalized to katakana before lookup.
function toKatakana(ch) {
  const code = ch.codePointAt(0);
  if (code >= 0x3041 && code <= 0x3096) return String.fromCharCode(code + 0x60);
  return ch;
}

// Full-width ASCII block (！-～, U+FF01-U+FF5E) maps 1:1 onto ASCII (!-~)
// by subtracting 0xFEE0. This cleanly normalizes full-width parens, colons,
// digits, letters, plus signs, etc. without touching kanji/kana at all.
// A couple of extra CJK-symbol-block characters are normalized by hand.
function normalizePassthroughChar(ch) {
  const code = ch.codePointAt(0);
  if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0);
  if (ch === '　') return ' '; // ideographic (full-width) space
  if (ch === '・') return ' '; // full-width middle dot "・" used as a title/name separator
  return ch;
}

// ---------------------------------------------------------------------------
// Hepburn romanization
// ---------------------------------------------------------------------------

// Base gojuon + voiced/semi-voiced/ヴ table, keyed by katakana.
const MORA_TABLE = {
  'ア': 'a', 'イ': 'i', 'ウ': 'u', 'エ': 'e', 'オ': 'o',
  'カ': 'ka', 'キ': 'ki', 'ク': 'ku', 'ケ': 'ke', 'コ': 'ko',
  'ガ': 'ga', 'ギ': 'gi', 'グ': 'gu', 'ゲ': 'ge', 'ゴ': 'go',
  'サ': 'sa', 'シ': 'shi', 'ス': 'su', 'セ': 'se', 'ソ': 'so',
  'ザ': 'za', 'ジ': 'ji', 'ズ': 'zu', 'ゼ': 'ze', 'ゾ': 'zo',
  'タ': 'ta', 'チ': 'chi', 'ツ': 'tsu', 'テ': 'te', 'ト': 'to',
  'ダ': 'da', 'ヂ': 'ji', 'ヅ': 'zu', 'デ': 'de', 'ド': 'do',
  'ナ': 'na', 'ニ': 'ni', 'ヌ': 'nu', 'ネ': 'ne', 'ノ': 'no',
  'ハ': 'ha', 'ヒ': 'hi', 'フ': 'fu', 'ヘ': 'he', 'ホ': 'ho',
  'バ': 'ba', 'ビ': 'bi', 'ブ': 'bu', 'ベ': 'be', 'ボ': 'bo',
  'パ': 'pa', 'ピ': 'pi', 'プ': 'pu', 'ペ': 'pe', 'ポ': 'po',
  'マ': 'ma', 'ミ': 'mi', 'ム': 'mu', 'メ': 'me', 'モ': 'mo',
  'ヤ': 'ya', 'ユ': 'yu', 'ヨ': 'yo',
  'ラ': 'ra', 'リ': 'ri', 'ル': 'ru', 'レ': 're', 'ロ': 'ro',
  'ワ': 'wa', 'ヲ': 'wo',
  'ン': 'n',
  'ヴ': 'vu',
  // Small forms, in case one shows up standalone rather than as a combiner.
  'ァ': 'a', 'ィ': 'i', 'ゥ': 'u', 'ェ': 'e', 'ォ': 'o',
  'ャ': 'ya', 'ュ': 'yu', 'ョ': 'yo',
};

const SMALL_Y_VOWEL = { 'ャ': 'a', 'ュ': 'u', 'ョ': 'o' };
const SMALL_V_VOWEL = { 'ァ': 'a', 'ィ': 'i', 'ゥ': 'u', 'ェ': 'e', 'ォ': 'o' };

// Base morae whose romaji supports the "base row + small ya/yu/yo" combining
// pattern (キャ=kya, シャ=sha, etc). Anything not in this set (vowels, ン, ヴ)
// simply won't combine with a following small-y character.
const PALATAL_ELIGIBLE = new Set(['ki', 'gi', 'shi', 'ji', 'chi', 'ni', 'hi', 'bi', 'pi', 'mi', 'ri']);

// キャ/シャ/etc: strip the trailing "i" off the base romaji to get the
// consonant stem, then add "y" + vowel -- except the sh/ch/j stems, which
// already carry the y-sound (shi/chi/ji), so shya/chya/jya would be wrong:
// シャ=sha (not shya), チャ=cha (not chya), ジャ=ja (not jya).
function palatalize(baseRomaji, vowel) {
  const stem = baseRomaji.slice(0, -1);
  if (stem === 'sh' || stem === 'ch' || stem === 'j') return stem + vowel;
  return stem + 'y' + vowel;
}

// ファ/ティ/ディ/トゥ/チェ/ジェ/ヴァ etc: swap the base mora's trailing vowel
// for the small vowel's sound. ウ + small vowel is the one true exception --
// ウ alone romanizes as bare "u" with no consonant, but ウィ/ウェ/ウォ etc.
// conventionally carry an inserted "w" glide (foreign "wi"/"we"/"wo" sounds).
function combineSmallVowel(baseKatakana, baseRomaji, vowel) {
  if (baseKatakana === 'ウ') return 'w' + vowel;
  if (baseRomaji.length <= 1) return baseRomaji + vowel;
  return baseRomaji.slice(0, -1) + vowel;
}

/**
 * Romanize one contiguous run of kana (already confirmed via isKana) using
 * Hepburn romanization. Handles small-tsu consonant doubling, small-y
 * palatalization, small-vowel digraphs (foreign loanword sounds), and the
 * long vowel mark.
 */
function romanizeKanaRun(run) {
  let out = '';
  let pendingSokuon = false;
  const n = run.length;
  let i = 0;

  while (i < n) {
    const kata = toKatakana(run[i]);

    if (kata === 'ッ') { // small tsu (sokuon) -> doubles the next consonant
      pendingSokuon = true;
      i += 1;
      continue;
    }

    if (kata === 'ー') { // long vowel mark -> repeat the previous vowel letter
      const lastCh = out.slice(-1).toLowerCase();
      if (lastCh && 'aiueo'.indexOf(lastCh) !== -1) out += lastCh;
      i += 1;
      continue;
    }

    let baseRomaji = MORA_TABLE[kata];
    if (baseRomaji === undefined) {
      // Unrecognized kana codepoint (shouldn't normally happen) -- skip it
      // rather than corrupting the output with an unknown character.
      i += 1;
      continue;
    }

    let consumed = 1;
    if (i + 1 < n) {
      const nextKata = toKatakana(run[i + 1]);
      if (SMALL_Y_VOWEL[nextKata] !== undefined && PALATAL_ELIGIBLE.has(baseRomaji)) {
        baseRomaji = palatalize(baseRomaji, SMALL_Y_VOWEL[nextKata]);
        consumed = 2;
      } else if (SMALL_V_VOWEL[nextKata] !== undefined) {
        baseRomaji = combineSmallVowel(kata, baseRomaji, SMALL_V_VOWEL[nextKata]);
        consumed = 2;
      }
    }

    if (pendingSokuon) {
      if (baseRomaji.slice(0, 2) === 'ch') {
        baseRomaji = 't' + baseRomaji; // sokuon+chi row is "tchi", not "cchi"
      } else if ('aiueo'.indexOf(baseRomaji.charAt(0)) === -1) {
        baseRomaji = baseRomaji.charAt(0) + baseRomaji; // double the leading consonant
      }
      pendingSokuon = false;
    }

    out += baseRomaji;
    i += consumed;
  }

  return out;
}

function capitalize(word) {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

/**
 * Walk `str` (already past the fixedPhrases substitution pass) and produce a
 * flat list of tokens describing how each piece was resolved. Exposed
 * separately from translateCardName() so analyze-corpus.js can gather
 * character-level coverage statistics without re-implementing this logic.
 *
 * Token shape: { type: 'word' | 'pass', text, kind, length }
 *   - kind 'compound'   : multi-char glossary compound hit (type 'word')
 *   - kind 'kanji-hit'  : single-kanji glossary hit (type 'word')
 *   - kind 'kanji-miss' : single kanji with no glossary entry -> left as-is (type 'pass')
 *   - kind 'romaji'     : a kana run converted via Hepburn romanization (type 'word')
 *   - kind 'plain'      : ASCII/Latin/punctuation passthrough (type 'pass')
 */
function segment(str, glossary) {
  const tokens = [];
  const n = str.length;
  let i = 0;

  while (i < n) {
    const ch = str[i];

    if (isKanji(ch)) {
      let matchedKey = null;
      for (const key of glossary.compoundKeys) {
        if (key.length <= n - i && str.startsWith(key, i)) {
          matchedKey = key;
          break;
        }
      }
      if (matchedKey) {
        tokens.push({ type: 'word', text: glossary.compounds[matchedKey], kind: 'compound', length: matchedKey.length });
        i += matchedKey.length;
        continue;
      }

      const single = glossary.kanji[ch];
      if (single !== undefined) {
        tokens.push({ type: 'word', text: single, kind: 'kanji-hit', length: 1 });
      } else {
        tokens.push({ type: 'pass', text: ch, kind: 'kanji-miss', length: 1 });
      }
      i += 1;
      continue;
    }

    if (isKana(ch)) {
      let j = i + 1;
      while (j < n && isKana(str[j])) j += 1;
      const run = str.slice(i, j);
      const romaji = capitalize(romanizeKanaRun(run));
      tokens.push({ type: 'word', text: romaji, kind: 'romaji', length: run.length });
      i = j;
      continue;
    }

    tokens.push({ type: 'pass', text: normalizePassthroughChar(ch), kind: 'plain', length: 1 });
    i += 1;
  }

  return tokens;
}

function isAsciiAlnum(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9');
}

// A boundary character counts as "word-like" (forces a space against an
// adjacent word token) if it's an ASCII letter/digit (e.g. "SP" bumping into
// a compound hit) OR a raw untranslated kanji left over from a kanji-miss
// token (e.g. an unmapped character bumping into a romaji word) -- but NOT
// punctuation/quotes/parens/whitespace, which should stay tight per spec.
function isWordLikeBoundary(ch) {
  return !!ch && (isAsciiAlnum(ch) || isKanji(ch));
}

/**
 * Join segmented tokens into the final English string.
 *
 * - Two consecutive "word" tokens (compound/kanji/romaji hits) always get a
 *   single space between them, so bare kanji/compound/kana lookups read as
 *   separate words (e.g. 月 + 華 -> "Moon Flower").
 * - Passthrough text (punctuation, quotes, parens, whitespace already in the
 *   source, and literal English spliced in by a fixedPhrases replacement) is
 *   never surrounded with an *added* space when it touches a word -- unless
 *   the immediately adjacent character on the passthrough side is itself an
 *   ASCII letter/digit (e.g. the "SP" in "(SP仕様)" butting straight up
 *   against the compound hit for 仕様). That keeps "(Foil Stamping)" and
 *   "Illusion" tight against their own punctuation while still separating
 *   "(SP" from "Specification" into "(SP Specification)".
 */
function joinTokens(tokens) {
  let out = '';
  let prevType = null; // 'word' | 'pass'

  for (const t of tokens) {
    if (t.text === '') continue;

    if (t.type === 'word') {
      if (prevType === 'word') {
        out += ' ';
      } else if (prevType === 'pass' && isWordLikeBoundary(out.slice(-1))) {
        out += ' ';
      }
      out += t.text;
      prevType = 'word';
    } else {
      if (prevType === 'word' && isWordLikeBoundary(t.text.charAt(0))) {
        out += ' ';
      }
      out += t.text;
      prevType = 'pass';
    }
  }

  return out.replace(/[ \t]+/g, ' ').trim();
}

function classifySource(usedFixedPhrase, compoundHits, kanjiHits, kanjiMisses, romajiHits) {
  const hasGlossary = usedFixedPhrase || compoundHits > 0 || kanjiHits > 0;
  const hasRomaji = romajiHits > 0;
  const hasUnresolved = kanjiMisses > 0;

  if (!hasGlossary && !hasRomaji && !hasUnresolved) return 'passthrough';
  if (hasGlossary && !hasRomaji && !hasUnresolved) return 'glossary';
  if (hasRomaji && !hasGlossary && !hasUnresolved) return 'romaji';
  return 'mixed';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Translate a single Japanese Vanguard card name into (approximate) English.
 * Pure, synchronous, zero network calls.
 *
 * @param {string} nameJp
 * @returns {{ nameEn: string, source: 'glossary'|'romaji'|'mixed'|'passthrough' }}
 */
function translateCardName(nameJp) {
  const { nameEn, source } = translateCardNameDetailed(nameJp);
  return { nameEn, source };
}

/**
 * Same as translateCardName() but also returns the token stream and
 * character-level tallies, for corpus analysis tooling. Not part of the
 * "minimal API" the rest of the app should depend on -- prefer
 * translateCardName() everywhere except analyze-corpus.js.
 */
function translateCardNameDetailed(nameJp) {
  if (typeof nameJp !== 'string' || nameJp.length === 0) {
    return { nameEn: '', source: 'passthrough', tokens: [], stats: { compoundChars: 0, kanjiHitChars: 0, kanjiMissChars: 0, romajiChars: 0, passthroughChars: 0 } };
  }

  const glossary = loadGlossary();

  let working = nameJp;
  let usedFixedPhrase = false;
  for (const key of glossary.fixedPhraseKeys) {
    if (working.indexOf(key) !== -1) {
      usedFixedPhrase = true;
      working = working.split(key).join(glossary.fixedPhrases[key]);
    }
  }

  const tokens = segment(working, glossary);
  const nameEn = joinTokens(tokens);

  const stats = { compoundChars: 0, kanjiHitChars: 0, kanjiMissChars: 0, romajiChars: 0, passthroughChars: 0 };
  let compoundHits = 0, kanjiHits = 0, kanjiMisses = 0, romajiHits = 0;
  for (const t of tokens) {
    if (t.kind === 'compound') { compoundHits += 1; stats.compoundChars += t.length; }
    else if (t.kind === 'kanji-hit') { kanjiHits += 1; stats.kanjiHitChars += t.length; }
    else if (t.kind === 'kanji-miss') { kanjiMisses += 1; stats.kanjiMissChars += t.length; }
    else if (t.kind === 'romaji') { romajiHits += 1; stats.romajiChars += t.length; }
    else { stats.passthroughChars += t.length; }
  }

  const source = classifySource(usedFixedPhrase, compoundHits, kanjiHits, kanjiMisses, romajiHits);
  return { nameEn, source, tokens, stats, usedFixedPhrase };
}

module.exports = {
  translateCardName,
  translateCardNameDetailed,
  // Exposed for analyze-corpus.js / tests only.
  _internals: { loadGlossary, isKanji, isKana, romanizeKanaRun, _resetGlossaryCache },
};
