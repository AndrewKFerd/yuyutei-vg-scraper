'use strict';

/**
 * Integration step: combine the scraped catalog with the official-name
 * matcher and the local glossary/romaji engine into the final dataset,
 * written locally for upload-cards.js to push to Supabase Storage.
 *
 * For each card: prefer a confident official English name (cf-vanguard);
 * then a fan translation from the Cardfight!! Vanguard wiki
 * (scrape-fandom.js; D-/DZ-, V-, G- and older cards, whichever series that
 * scrape covered); otherwise fall back to the locally-built
 * translation engine.
 *
 * Besides the full cards.json it writes the split the new frontend loads:
 * catalog.json (slim) and details/<setSlug>.json (see catalog-split.js).
 *
 * Also stamps listings whose price moved in the last 7 days with a small
 * `chg7d` field (from price-history.json, which record-history.js has
 * already updated this run), so tiles can show a change chip without
 * loading the history file.
 */

const fs = require('fs');
const path = require('path');

const { translateCardName } = require('./translate-engine');
const { findOfficialName } = require('./match-official');
const { findFandomCard } = require('./match-fandom');
const { groupKey } = require('./card-group');
const { checkCatalogSize, allowShrinkFromEnv } = require('./catalog-gate');
const { checkOfficialRetention, allowOfficialShrinkFromEnv } = require('./reference-gate');
const { toMinute, minuteToIso, normalizeHistory, computeChg7d } = require('./price-history');
const { writeFileAtomic } = require('./fs-atomic');
const { buildSlimCatalog, buildDetailShards, writeDetailShards } = require('./catalog-split');

const CATALOG_PATH = path.join(__dirname, 'data', 'catalog-raw.json');
const SKILLS_PATH = path.join(__dirname, 'data', 'card-details-raw.json');
const HISTORY_PATH = path.join(__dirname, 'data', 'price-history.json');
// The full per-card file. Still written (and uploaded, served as /api/cards)
// for two reasons: this build's own gates compare against the previous one,
// and the frontend currently deployed predates the split below -- the
// pipeline uploads independently of Vercel deploys, so it must keep working
// until the new frontend ships. Once it has, upload-cards.js can stop
// uploading this (README: "Catalog split").
const OUT_PATH = path.join(__dirname, 'data', 'cards.json');
// What the new frontend loads (see catalog-split.js): a slim catalog for the
// grid plus one detail shard per set, fetched when a card is opened.
const CATALOG_OUT_PATH = path.join(__dirname, 'data', 'catalog.json');
const DETAILS_DIR = path.join(__dirname, 'data', 'details');

// Baselines from the cards.json this build would replace: its size (the
// run gate) and which listings had an official English name (the official
// retention gate). Missing/unparseable -> count null (only the zero-cards
// check) and no official ids (no retention check).
function readExisting() {
  try {
    const existing = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
    if (!Array.isArray(existing.cards)) {
      return { count: Number.isFinite(existing.count) ? existing.count : null, officialIds: new Set() };
    }
    const officialIds = new Set(
      existing.cards.filter((c) => c && c.translationSource === 'official').map((c) => c.id)
    );
    return { count: existing.cards.length, officialIds };
  } catch {
    return { count: null, officialIds: new Set() };
  }
}

function loadPriceHistory(scrapedAt) {
  let history;
  try {
    history = normalizeHistory(JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')));
  } catch (err) {
    console.warn(
      `[build-data] Can't read ${HISTORY_PATH} (${err.message}) -- cards will have no chg7d. ` +
      'Run record-history.js first if you want it.'
    );
    return null;
  }
  const asOf = history.runs[history.runs.length - 1];
  const scrapedMinute = toMinute(Date.parse(scrapedAt));
  if (asOf !== scrapedMinute) {
    // chg7d still only appears where the history's latest price matches
    // the card's, but "last 7 days" is measured from the history's last run.
    console.warn(
      `[build-data] price-history.json's last run (${minuteToIso(asOf)}) isn't this catalog's scrape ` +
      `(${minuteToIso(scrapedMinute)}) -- run record-history.js before build-data.js for an up-to-date chg7d.`
    );
  }
  return { history, asOf };
}

function loadSkillsIndex() {
  try {
    const raw = JSON.parse(fs.readFileSync(SKILLS_PATH, 'utf8'));
    return raw.skills || {};
  } catch (err) {
    console.warn(
      `[build-data] No ${SKILLS_PATH} found (${err.message}) -- cards will have no Japanese ` +
      'skill text. Run scrape-card-detail.js first if you want it.'
    );
    return {};
  }
}

// Both fields end up as raw `<a href>`/`<img src>` values in the frontend.
// Cheap belt-and-suspenders check against a compromised/malformed source
// page ever slipping a non-http(s) or off-site URL (e.g. `javascript:`)
// into the shipped dataset.
const ALLOWED_URL_RE = /^https:\/\/(card\.)?yuyu-tei\.jp\//i;

function sanitizeUrl(url) {
  return typeof url === 'string' && ALLOWED_URL_RE.test(url) ? url : null;
}

function main() {
  const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

  // Never replace a good cards.json with an empty or partial one: the live
  // site was once sent 0 cards (three times) and 22,235 of 28k (once), and
  // visitors' clients cache whatever they get for a day. Checked before any
  // work, so a bad catalog leaves the existing file untouched.
  const existing = readExisting();
  const gate = checkCatalogSize(
    Array.isArray(raw.cards) ? raw.cards.length : 0,
    existing.count,
    { allowShrink: allowShrinkFromEnv() }
  );
  if (!gate.ok) {
    console.error(`[build-data] ${gate.message} ${OUT_PATH} was left unchanged.`);
    process.exit(1);
  }
  if (gate.message) console.warn(`[build-data] ${gate.message}`);

  const skillsIndex = loadSkillsIndex();
  const priceHistory = loadPriceHistory(raw.scrapedAt);
  const sourceCounts = { official: 0, fandom: 0, glossary: 0, romaji: 0, mixed: 0, passthrough: 0 };
  let droppedUrls = 0;
  let skillTextEnCount = 0;
  let skillTextJpCount = 0;
  let chg7dCount = 0;

  const cards = raw.cards.map((c) => {
    let nameEn;
    let translationSource;
    let kind = null;
    let clan = null;
    let grade = null;
    let power = null;
    let shield = null;
    let skillTextEn = null;
    let flavorEn = null;
    let wikiTitle = null;

    const official = findOfficialName(c.setCode, c.nameJp);
    const fandom = official ? null : findFandomCard(c.setCode, c.nameJp);
    if (official) {
      nameEn = official.nameEn;
      translationSource = 'official';
      kind = official.kind;
      clan = official.clan;
      grade = official.grade;
      power = official.power;
      shield = official.shield;
      // cf-vanguard delivers all abilities as one run-on line; the printed
      // card starts each on its own line, so restore that at ability
      // keywords (the modal renders with whitespace-pre-line).
      skillTextEn = official.skillText
        ? official.skillText.replace(/(?<=\S)\s*(\[(?:CONT|ACT|AUTO)\])/g, '\n$1')
        : null;
    } else if (fandom) {
      // Fan translation (CC BY-SA) -- the frontend credits and links
      // wikiTitle's page wherever this text is shown.
      nameEn = fandom.nameEn;
      translationSource = 'fandom';
      clan = fandom.nation;
      grade = fandom.grade;
      power = fandom.power;
      shield = fandom.shield;
      skillTextEn = fandom.effect;
      flavorEn = fandom.flavor;
      // Usually identical to the name -- only shipped when it differs
      // (a disambiguated title), the frontend falls back to nameEn.
      wikiTitle = fandom.title !== fandom.nameEn ? fandom.title : null;
    } else {
      const local = translateCardName(c.nameJp);
      nameEn = local.nameEn;
      translationSource = local.source;
    }

    sourceCounts[translationSource] = (sourceCounts[translationSource] || 0) + 1;
    if (skillTextEn) skillTextEnCount++;

    // Per-card detail scraped from yuyu-tei (scrape-card-detail.js), keyed
    // by card identity rather than listing so every foil/parallel variant
    // shares the one fetched result. The stat line fills in whatever the
    // official match didn't provide -- for the ~78% of cards with no
    // English release this is the only source. Japanese labels are kept
    // as-is for text fields (kind/clan) so the UI isn't showing a
    // machine-mangled "translation" of a proper noun.
    const detail = skillsIndex[groupKey(c)] || null;
    const skillTextJp = detail?.effect || null;
    // The modal shows one flavor line, English when available -- skip
    // shipping the Japanese one it would never display.
    const flavorJp = flavorEn ? null : detail?.flavor || null;
    if (skillTextJp) skillTextJpCount++;
    if (detail) {
      kind ??= detail.kind ?? null;
      clan ??= detail.clan ?? detail.nation ?? null;
      grade ??= detail.grade ?? null;
      power ??= detail.power ?? null;
      shield ??= detail.shield ?? null;
    }

    const imageUrl = sanitizeUrl(c.imageUrl);
    const detailUrl = sanitizeUrl(c.detailUrl);
    if (!imageUrl || !detailUrl) droppedUrls++;

    // c.id is yuyu-tei's per-set product number, not globally unique
    // (yuyu-tei reuses it across sets) — compose with setSlug so every
    // card in this catalog has a truly unique id (used as the frontend's
    // React list key, and as the price history's listing key).
    const id = `${c.setSlug}/${c.id}`;

    const chg7d = priceHistory
      ? computeChg7d(priceHistory.history.cards[id], priceHistory.asOf, c.price)
      : null;
    if (chg7d) chg7dCount++;

    return {
      id,
      setCode: c.setCode,
      setSlug: c.setSlug,
      rarity: c.rarity,
      nameJp: c.nameJp,
      nameEn,
      translationSource,
      // From the official English match when there is one, else from the
      // yuyu-tei detail scrape (Japanese labels) -- null if neither had it.
      kind,
      clan,
      grade,
      power,
      shield,
      // English rules text: official for cards with an EN release, else the
      // wiki's fan translation (translationSource says which).
      skillTextEn,
      flavorEn,
      // Source page on cardfight.fandom.com for fan-translated text, for
      // credit -- null when it's just nameEn.
      wikiTitle,
      // Japanese rules/flavor text from scrape-card-detail.js; null until
      // that's been run, or for cards yuyu-tei hasn't filled in (brand-new
      // sets) or that have no text (tokens/markers).
      skillTextJp,
      flavorJp,
      price: c.price,
      priceDisplay: c.priceDisplay,
      stock: c.stock,
      // { from, at } -- the price 7 days ago and the minute it last changed
      // -- only on listings whose price moved in that window; omitted
      // (not null) otherwise to keep the ~30 MB payload from growing.
      ...(chg7d ? { chg7d } : {}),
      imageUrl,
      detailUrl,
    };
  });

  // Backstop for a missing/incomplete cf-vanguard-raw.json (which
  // scrape-cf-vanguard.js already refuses to write): listings that had an
  // official English name last build and are still listed must keep it,
  // or visitors get a day of romaji in place of real names.
  let officialBefore = 0;
  let officialKept = 0;
  for (const card of cards) {
    if (!existing.officialIds.has(card.id)) continue;
    officialBefore++;
    if (card.translationSource === 'official') officialKept++;
  }
  const retention = checkOfficialRetention(officialKept, officialBefore, { allowShrink: allowOfficialShrinkFromEnv() });
  if (!retention.ok) {
    console.error(`[build-data] ${retention.message} ${OUT_PATH} was left unchanged.`);
    process.exit(1);
  }
  if (retention.message) console.warn(`[build-data] ${retention.message}`);

  const payload = {
    generatedAt: new Date().toISOString(),
    count: cards.length,
    cards,
  };

  // Shards first, then the catalog that points at them, then the full file:
  // a crash part-way leaves the previous cards.json (the gates' baseline)
  // untouched, and the next run simply redoes the split.
  const shards = buildDetailShards(cards);
  const shardStats = writeDetailShards(DETAILS_DIR, shards);
  writeFileAtomic(CATALOG_OUT_PATH, JSON.stringify(buildSlimCatalog(cards, { generatedAt: payload.generatedAt, sets: raw.sets })));
  writeFileAtomic(OUT_PATH, JSON.stringify(payload));

  console.log(`Wrote ${cards.length} cards to ${OUT_PATH}`);
  console.log('translationSource breakdown:', sourceCounts);
  console.log(`Skill text: ${skillTextEnCount} English (official or fan),${skillTextJpCount} scraped (JP).`);
  if (priceHistory) console.log(`chg7d: ${chg7dCount} card(s) changed price in the 7 days to ${minuteToIso(priceHistory.asOf)}.`);
  if (droppedUrls > 0) {
    console.warn(`${droppedUrls} card(s) had an imageUrl/detailUrl outside the yuyu-tei.jp allowlist (set to null).`);
  }
  const sizeMb = (p) => (fs.statSync(p).size / (1024 * 1024)).toFixed(2);
  console.log(`Output size: ${sizeMb(OUT_PATH)} MB cards.json, ${sizeMb(CATALOG_OUT_PATH)} MB catalog.json`);
  console.log(
    `Detail shards: ${shards.size} sets (${shardStats.written} rewritten, ${shardStats.unchanged} unchanged, ` +
    `${shardStats.removed} removed)`
  );
}

main();
