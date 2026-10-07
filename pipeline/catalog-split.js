'use strict';

/**
 * Splits the full card list (cards.json, ~30 MB) into what the browser needs
 * up front and what it only needs when a card is opened:
 *
 *  - catalog.json         slim cards for the grid, search, filters and
 *                         Market Movers (~5 MB raw, ~0.5 MB brotli)
 *  - details/<slug>.json  one file per set: card id -> the heavy per-card
 *                         fields (skill text, flavor, stat line, wiki
 *                         title), fetched when a card of that set is opened
 *
 * Why: /api/cards was never an edge-cache hit (the response is over Vercel's
 * cacheable size), so every visitor's daily load ran the function and pulled
 * 30 MB out of Supabase. The slim catalog is small enough to cache.
 *
 * The slim card drops what the client can recompute: imageUrl, detailUrl and
 * priceDisplay are omitted whenever they equal their derivation from the id /
 * price (frontend/src/catalogFormat.js is the inverse and must stay in sync;
 * test/catalog-split.test.js round-trips the two). A field that differs --
 * the 223 "noimage" placeholders, a null -- is kept explicitly.
 *
 * Shard contents are deterministic (ids sorted, nulls omitted, no timestamp):
 * upload-cards.js decides what to re-upload by content hash, so a shard must
 * only change when its set's data does.
 */

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./fs-atomic');

// Fields that only the card modal shows. translationSource is deliberately
// NOT here: Market Movers ranks a group's representative printing by it, and
// the modal reads it for the wiki credit, so it stays on the slim card (a few
// bytes each, and it compresses to almost nothing).
const DETAIL_FIELDS = [
  'kind', 'clan', 'grade', 'power', 'shield',
  'skillTextEn', 'skillTextJp', 'flavorEn', 'flavorJp', 'wikiTitle',
];

// The only slugs the API serves a shard for (frontend/api/_supabaseCards.js
// enforces the same pattern). Real slugs are lowercase alphanumerics and
// hyphens; a card with anything else would get no shard, so refuse to build.
const SLUG_RE = /^[a-z0-9-]+$/;

const DETAILS_FORMAT_VERSION = 1;
const CATALOG_FORMAT_VERSION = 1;

const derivedImageUrl = (id) => `https://card.yuyu-tei.jp/vg/100_140/${id}.jpg`;
const derivedDetailUrl = (id) => `https://yuyu-tei.jp/sell/vg/card/${id}`;
const derivedPriceDisplay = (price) => (Number.isFinite(price) ? `¥${price.toLocaleString('en-US')}` : null);

/** One card, minus the heavy fields and anything the client can derive. */
function slimCard(card) {
  const slim = {
    id: card.id,
    setCode: card.setCode,
    setSlug: card.setSlug,
    rarity: card.rarity,
    nameJp: card.nameJp,
    nameEn: card.nameEn,
    translationSource: card.translationSource,
    price: card.price,
    stock: card.stock,
  };
  if (card.chg7d) slim.chg7d = card.chg7d;
  // `!==` against the derivation, not truthiness: an explicit null (a URL the
  // allowlist rejected) must survive as null rather than be re-derived.
  if (card.imageUrl !== derivedImageUrl(card.id)) slim.imageUrl = card.imageUrl;
  if (card.detailUrl !== derivedDetailUrl(card.id)) slim.detailUrl = card.detailUrl;
  if (card.priceDisplay !== derivedPriceDisplay(card.price)) slim.priceDisplay = card.priceDisplay;
  return slim;
}

/** The slim catalog payload for a full card list. */
function buildSlimCatalog(cards, { generatedAt }) {
  return {
    v: CATALOG_FORMAT_VERSION,
    generatedAt,
    count: cards.length,
    cards: cards.map(slimCard),
  };
}

/** A card's heavy fields with nulls dropped, or null when it has none. */
function detailOf(card) {
  const detail = {};
  for (const field of DETAIL_FIELDS) {
    if (card[field] !== null && card[field] !== undefined) detail[field] = card[field];
  }
  return Object.keys(detail).length > 0 ? detail : null;
}

/**
 * setSlug -> shard payload. Every set gets a shard, even one whose cards have
 * no heavy fields (an empty map), so the client never has to tell "no
 * details" apart from "shard missing".
 */
function buildDetailShards(cards) {
  const bySlug = new Map();
  const skipped = new Set();
  for (const card of cards) {
    if (!SLUG_RE.test(card.setSlug || '')) {
      // The API only serves [a-z0-9-] slugs. One odd set must not fail the
      // whole build (and with it the price-history backup upload): its cards
      // stay in the catalog, and the modal's error/Retry path covers them.
      skipped.add(card.setSlug);
      continue;
    }
    if (!bySlug.has(card.setSlug)) bySlug.set(card.setSlug, {});
    const detail = detailOf(card);
    if (detail) bySlug.get(card.setSlug)[card.id] = detail;
  }
  if (skipped.size > 0) {
    console.warn(
      `[catalog-split] No detail shard for set slug(s) ${[...skipped].map((s) => JSON.stringify(s)).join(', ')}: ` +
      'not servable (only lowercase letters, digits and hyphens are). Their cards open without skill text.'
    );
  }
  const shards = new Map();
  for (const slug of [...bySlug.keys()].sort()) {
    const entries = bySlug.get(slug);
    const sorted = {};
    for (const id of Object.keys(entries).sort()) sorted[id] = entries[id];
    shards.set(slug, { v: DETAILS_FORMAT_VERSION, set: slug, cards: sorted });
  }
  return shards;
}

/** Writes `content` unless the file already holds exactly that (spares the fsync and the mtime). */
function writeIfChanged(filePath, content) {
  try {
    if (fs.readFileSync(filePath, 'utf8') === content) return false;
  } catch {
    // missing/unreadable: write it
  }
  writeFileAtomic(filePath, content);
  return true;
}

/**
 * Writes every shard to `dir` and removes shard files for sets that no longer
 * exist. Returns { written, unchanged, removed } counts.
 */
function writeDetailShards(dir, shards) {
  fs.mkdirSync(dir, { recursive: true });
  let written = 0;
  for (const [slug, payload] of shards) {
    if (writeIfChanged(path.join(dir, `${slug}.json`), JSON.stringify(payload))) written++;
  }
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    const m = /^(.*)\.json$/.exec(name);
    if (!m || shards.has(m[1])) continue;
    fs.rmSync(path.join(dir, name), { force: true });
    removed++;
  }
  return { written, unchanged: shards.size - written, removed };
}

module.exports = {
  DETAIL_FIELDS,
  SLUG_RE,
  derivedImageUrl,
  derivedDetailUrl,
  derivedPriceDisplay,
  slimCard,
  buildSlimCatalog,
  detailOf,
  buildDetailShards,
  writeDetailShards,
};
