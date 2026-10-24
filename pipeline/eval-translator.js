'use strict';

/**
 * Scores the card modal's rules-text translator (frontend/src/translate)
 * against real English, and lists what it still can't read.
 *
 *  1. Held-out official pairs: one card in ten (by card key) is kept out of
 *     the line memory (buildMemory({ holdout: true })) and translated
 *     here. Reported: lines with no Japanese left, exact matches, and token
 *     F1 against the official text.
 *  2. Wiki pairs (V/G/original series, plus D/DZ): token F1 only -- the wiki
 *     writes "COST [Counter Blast (1)]" where the translator writes
 *     "[COST][Counter-Blast 1]", so exact matches mean little there.
 *  3. The real workload: every card that has Japanese text but no English
 *     in data/cards.json. Reported: the share of its Japanese left
 *     untranslated, and the most common untranslated runs (numbers and
 *     names generalized), which is the to-do list for grammar.js.
 *
 * Usage: node eval-translator.js [--top 50] [--show 10]
 */

const path = require('path');
const { pathToFileURL } = require('url');
const { loadPairs } = require('./translation-pairs');
const { buildMemory, isHeldOut } = require('./build-translation-memory');

const TRANSLATE = path.join(__dirname, '..', 'frontend', 'src', 'translate', 'index.js');

function tokens(text) {
  return String(text)
    .toLowerCase()
    .replace(/\[([a-z\- ]+?)\s*(\d+)\]/g, '$1 $2')
    .match(/[a-z0-9]+/g) || [];
}

function f1(candidate, reference) {
  const c = tokens(candidate);
  const r = tokens(reference);
  if (!c.length || !r.length) return 0;
  const counts = new Map();
  for (const t of r) counts.set(t, (counts.get(t) || 0) + 1);
  let hit = 0;
  for (const t of c) {
    const n = counts.get(t);
    if (n) {
      hit++;
      counts.set(t, n - 1);
    }
  }
  if (!hit) return 0;
  const p = hit / c.length;
  const rc = hit / r.length;
  return (2 * p * rc) / (p + rc);
}

const generalize = (s) => s.replace(/「[^」]*」/g, '「N」').replace(/\d+/g, '#');

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => {
    const i = args.indexOf(name);
    return i === -1 ? dflt : Number(args[i + 1]);
  };
  const top = opt('--top', 40);
  const show = opt('--show', 0);
  // --eras DZ,D: collect untranslated clauses from these eras' wiki lines only.
  const erasArg = args.indexOf('--eras');
  const eras = erasArg === -1 ? null : new Set(args[erasArg + 1].split(','));

  const { translateRules, buildNameIndex } = await import(pathToFileURL(TRANSLATE).href);
  const { debug } = await import(pathToFileURL(path.join(path.dirname(TRANSLATE), 'grammar.js')).href);
  const built = require(path.join(__dirname, 'data', 'cards.json'));
  const cards = built.cards || built;
  const names = buildNameIndex(cards);

  const { pairs } = loadPairs();
  // Scored against a memory built without the held-out cards.
  const memory = await buildMemory({ holdout: true });
  const run = (p) => translateRules(p.jp, { card: { setCode: p.setCode, nameJp: p.nameJp, nameEn: p.nameEn }, names, memory });

  // 1. held-out official
  const held = pairs.filter((p) => p.source === 'official' && isHeldOut(p.key));
  let clean = 0;
  let exact = 0;
  let f1Sum = 0;
  const shown = [];
  for (const p of held) {
    const r = run(p);
    if (r.coverage === 1) clean++;
    if (r.text === p.en) exact++;
    f1Sum += f1(r.text, p.en);
    if (shown.length < show && Math.random() < 0.1) shown.push({ jp: p.jp, out: r.text, en: p.en });
  }
  console.log(`Held-out official lines: ${held.length}`);
  console.log(`  fully translated: ${pct(clean, held.length)}   exact: ${pct(exact, held.length)}   token F1: ${(f1Sum / held.length).toFixed(3)}`);

  debug.clauses = [];
  debug.headers = [];
  // 2. wiki, by era
  const byEra = new Map();
  for (const p of pairs.filter((x) => x.source === 'fandom')) {
    const era = p.key.split('|')[0];
    const e = byEra.get(era) || { n: 0, clean: 0, f1: 0 };
    const saved = { clauses: debug.clauses, headers: debug.headers };
    if (eras && !eras.has(era)) {
      debug.clauses = null;
      debug.headers = null;
    }
    const r = run(p);
    Object.assign(debug, saved);
    e.n++;
    if (r.coverage === 1) e.clean++;
    e.f1 += f1(r.text, p.en);
    byEra.set(era, e);
  }
  console.log('Wiki lines by era:');
  for (const [era, e] of [...byEra].sort()) {
    console.log(`  ${era.padEnd(7)} ${String(e.n).padStart(6)} lines   fully translated: ${pct(e.clean, e.n)}   token F1: ${(e.f1 / e.n).toFixed(3)}`);
  }

  const tally = (list) => [...list.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map())].sort((x, y) => y[1] - x[1]);
  console.log(`Untranslated clauses in wiki-paired lines: ${debug.clauses.length} (top ${top}):`);
  for (const [c, n] of tally(debug.clauses).slice(0, top)) console.log(`  ${String(n).padStart(5)}  ${c}`);
  console.log(`Unread headers: ${debug.headers.length} (top 25):`);
  for (const [c, n] of tally(debug.headers).slice(0, 25)) console.log(`  ${String(n).padStart(5)}  ${c}`);
  debug.clauses = null;
  debug.headers = null;

  // 3. the real workload
  const { groupKey } = require('./card-group');
  const seen = new Set();
  let jpChars = 0;
  let leftChars = 0;
  let targetCards = 0;
  let targetClean = 0;
  const runs = new Map();
  for (const card of cards) {
    if (!card.skillTextJp || card.skillTextEn) continue;
    const key = groupKey(card);
    if (seen.has(key)) continue;
    seen.add(key);
    targetCards++;
    const r = translateRules(card.skillTextJp, { card, names, memory });
    const total = (card.skillTextJp.match(/[぀-ヿ㐀-鿿]/g) || []).length;
    jpChars += total;
    leftChars += Math.round(total * (1 - r.coverage));
    if (r.coverage === 1) targetClean++;
    for (const s of r.segments) {
      if (!s.untranslated) continue;
      const g = generalize(s.text);
      runs.set(g, (runs.get(g) || 0) + 1);
    }
  }
  console.log(`Cards with only Japanese text: ${targetCards}   fully translated: ${pct(targetClean, targetCards)}   Japanese left: ${pct(leftChars, jpChars)}`);
  console.log(`Most common untranslated runs (top ${top}):`);
  for (const [s, n] of [...runs].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`  ${String(n).padStart(4)}  ${s}`);

  for (const s of shown) console.log(`\nJP  ${s.jp}\nOUT ${s.out}\nEN  ${s.en}`);
}

function pct(a, b) {
  return b ? `${((a / b) * 100).toFixed(1)}%` : 'n/a';
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
