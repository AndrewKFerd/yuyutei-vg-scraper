'use strict';

/**
 * analyze-corpus.js
 *
 * Corpus-driven glossary gap report for the offline translation engine.
 *
 * 1. Loads whatever raw card data is available: pipeline/data/catalog-raw.json
 *    if present (produced by the parallel scraping effort), otherwise falls
 *    back to backend/data/cards-dzbt16.json (247 real sample card names
 *    already in this repo). Either way, extracts every `nameJp` string.
 * 2. Runs each name through translateCardNameDetailed() and reports what % of
 *    "meaningful" Japanese characters (kanji/kana, excluding anything already
 *    consumed by a fixedPhrases match, and excluding pure ASCII/punctuation)
 *    resolved as a clean compound/glossary hit vs. needed a kanji-by-kanji or
 *    romaji fallback.
 * 3. Prints the top N most-frequent individual kanji characters that have NO
 *    entry in glossary.json's `kanji` table, ranked by frequency.
 *
 * Usage: node pipeline/analyze-corpus.js
 */

const fs = require('fs');
const path = require('path');

const { translateCardNameDetailed, _internals } = require('./translate-engine');

const CATALOG_RAW_PATH = path.join(__dirname, 'data', 'catalog-raw.json');
const FALLBACK_SAMPLE_PATH = path.join(__dirname, '..', 'backend', 'data', 'cards-dzbt16.json');
const GLOSSARY_PATH = path.join(__dirname, 'data', 'glossary.json');

function loadCardNames() {
  let sourcePath = CATALOG_RAW_PATH;
  let usedFallback = false;
  if (!fs.existsSync(sourcePath)) {
    sourcePath = FALLBACK_SAMPLE_PATH;
    usedFallback = true;
  }

  const raw = fs.readFileSync(sourcePath, 'utf8');
  const data = JSON.parse(raw);

  // Robust to unknown wrapper shapes: recursively collect every string value
  // found under a `nameJp` key, anywhere in the structure.
  const names = [];
  function walk(node) {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) {
        if (key === 'nameJp' && typeof node[key] === 'string') {
          names.push(node[key]);
        } else {
          walk(node[key]);
        }
      }
    }
  }
  walk(data);

  return { names, sourcePath, usedFallback };
}

function analyze(names) {
  let compoundChars = 0;
  let kanjiHitChars = 0;
  let kanjiMissChars = 0;
  let romajiChars = 0;
  let passthroughChars = 0;

  const sourceCounts = { glossary: 0, romaji: 0, mixed: 0, passthrough: 0 };
  const missFrequency = new Map();

  for (const nameJp of names) {
    const { source, stats, tokens } = translateCardNameDetailed(nameJp);
    compoundChars += stats.compoundChars;
    kanjiHitChars += stats.kanjiHitChars;
    kanjiMissChars += stats.kanjiMissChars;
    romajiChars += stats.romajiChars;
    passthroughChars += stats.passthroughChars;
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;

    for (const t of tokens) {
      if (t.kind === 'kanji-miss') {
        missFrequency.set(t.text, (missFrequency.get(t.text) || 0) + 1);
      }
    }
  }

  const translatableTotal = compoundChars + kanjiHitChars + kanjiMissChars + romajiChars;
  const fallbackChars = kanjiHitChars + kanjiMissChars + romajiChars; // kanji-by-kanji OR romaji
  const cleanChars = compoundChars; // clean compound/glossary (whole-word) hits

  const pct = (n, d) => (d === 0 ? '0.0' : ((n / d) * 100).toFixed(1));

  return {
    totalNames: names.length,
    compoundChars,
    kanjiHitChars,
    kanjiMissChars,
    romajiChars,
    passthroughChars,
    translatableTotal,
    fallbackChars,
    cleanChars,
    fallbackPct: pct(fallbackChars, translatableTotal),
    cleanPct: pct(cleanChars, translatableTotal),
    sourceCounts,
    missFrequency,
  };
}

function printReport(label, result, topN) {
  console.log(`\n=== ${label} ===`);
  console.log(`Card names analyzed: ${result.totalNames}`);
  console.log(`Translatable (non-fixedPhrase, non-ASCII) characters: ${result.translatableTotal}`);
  console.log(`  Clean compound/glossary hits : ${result.cleanChars} (${result.cleanPct}%)`);
  console.log(`  Kanji-by-kanji fallback      : ${result.kanjiHitChars + result.kanjiMissChars} chars` +
    ` (${result.kanjiHitChars} resolved via kanji table, ${result.kanjiMissChars} with NO glossary entry)`);
  console.log(`  Romaji (kana) fallback       : ${result.romajiChars} chars`);
  console.log(`  Fallback total (kanji-by-kanji + romaji): ${result.fallbackChars} (${result.fallbackPct}%)`);
  console.log(`Per-name source classification:`, result.sourceCounts);

  const sortedMisses = Array.from(result.missFrequency.entries()).sort((a, b) => b[1] - a[1]);
  console.log(`\nTop ${topN} highest-frequency kanji with NO glossary.json 'kanji' entry:`);
  sortedMisses.slice(0, topN).forEach(([ch, count], idx) => {
    console.log(`  ${String(idx + 1).padStart(2)}. ${ch}  x${count}`);
  });
  if (sortedMisses.length === 0) {
    console.log('  (none -- full coverage on this corpus!)');
  }

  return sortedMisses;
}

function main() {
  const { names, sourcePath, usedFallback } = loadCardNames();
  console.log(`Loaded ${names.length} card names from ${sourcePath}${usedFallback ? ' (fallback sample -- catalog-raw.json not found yet)' : ''}`);

  const before = analyze(names);
  printReport('BEFORE glossary additions', before, 50);

  console.log('\n(See translate-engine.js glossary additions applied separately; re-run this script after editing glossary.json to see the after-state.)');
}

if (require.main === module) {
  main();
}

module.exports = { loadCardNames, analyze, printReport };
