'use strict';

/**
 * Live-update artifacts for the frontend: a price/stock delta between the
 * previously published catalog and this one, plus meta.json, the tiny
 * manifest clients poll to learn that something new is out.
 *
 *   deltas/<stamp>.json   { v, from, to, changes: [[id, price, stock], ...] }
 *                         immutable; <stamp> is `to` as YYYYMMDDTHHMMSSZ
 *   meta.json             { v, generatedAt, structHash, deltas: [{from, to, key, n}] }
 *
 * A delta can only say "this listing's price/stock is now X". Anything else
 * that changes (a card appears or disappears, a name or set changes, the
 * order moves) changes `structHash`, which is a hash of the catalog minus
 * price, stock, priceDisplay and chg7d. When the hash differs, or the chain
 * would be useless (too many rows changed), no delta is emitted, the chain in
 * meta.json restarts empty and clients reload the whole catalog.
 *
 * The baseline (data/catalog-published.json) is what the bucket held after the
 * last successful upload; upload-cards.js writes it only once everything is up.
 */

const crypto = require('crypto');

const META_VERSION = 1;
const DELTA_VERSION = 1;
const MAX_CHAIN = 12; // ~6 h of 30-min runs
const MAX_CHANGED_SHARE = 0.25; // as the history's content gate: past this a full reload is cheaper
const META_KEY = 'meta.json';
const DELTA_KEY_RE = /^deltas\/\d{8}T\d{6}Z\.json$/;
// Fields a delta carries (or that follow from them); everything else is structure.
const VOLATILE_FIELDS = ['price', 'stock', 'priceDisplay', 'chg7d'];

/** YYYYMMDDTHHMMSSZ for an ISO time, or null when it isn't one. */
function stampOf(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

const deltaKeyFor = (iso) => {
  const stamp = stampOf(iso);
  return stamp ? `deltas/${stamp}.json` : null;
};

/** Hash of everything in a slim catalog that a price/stock delta cannot express. */
function structHash(catalog) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify({ nations: catalog.nations ?? null, sets: catalog.sets ?? null }));
  for (const card of catalog.cards) {
    const rest = { ...card };
    for (const field of VOLATILE_FIELDS) delete rest[field];
    hash.update('\n');
    hash.update(JSON.stringify(rest));
  }
  return hash.digest('hex').slice(0, 32);
}

/** The baseline for a slim catalog: { generatedAt, structHash, cards: { id: [price, stock] } }. */
function stateOf(catalog) {
  const cards = {};
  for (const card of catalog.cards) cards[card.id] = [card.price ?? null, card.stock ?? null];
  return { generatedAt: catalog.generatedAt, structHash: structHash(catalog), cards };
}

/**
 * The delta from `prev` (a baseline) to the `next` slim catalog.
 * Resolves { delta } or { delta: null, reason } -- never throws on bad input.
 */
function diffCatalogs(prev, next, { maxChangedShare = MAX_CHANGED_SHARE } = {}) {
  if (!prev || typeof prev.cards !== 'object' || !prev.generatedAt) return { delta: null, reason: 'no baseline' };
  if (!next || !Array.isArray(next.cards) || !next.generatedAt) return { delta: null, reason: 'no catalog' };
  if (prev.generatedAt === next.generatedAt) return { delta: null, reason: 'same build' };
  if (!deltaKeyFor(prev.generatedAt) || !deltaKeyFor(next.generatedAt)) return { delta: null, reason: 'bad timestamp' };
  if (prev.structHash !== structHash(next)) return { delta: null, reason: 'structure changed' };

  const changes = [];
  for (const card of next.cards) {
    const was = prev.cards[card.id];
    const price = card.price ?? null;
    const stock = card.stock ?? null;
    if (!was) return { delta: null, reason: 'structure changed' };
    if (was[0] !== price || was[1] !== stock) changes.push([card.id, price, stock]);
  }
  if (changes.length > next.cards.length * maxChangedShare) {
    return { delta: null, reason: `${changes.length} of ${next.cards.length} listings changed` };
  }
  return { delta: { v: DELTA_VERSION, from: prev.generatedAt, to: next.generatedAt, changes } };
}

/**
 * meta.json for a new catalog: the previous chain (when it still ends where
 * the new delta starts) plus the new delta; an empty chain when there is no
 * delta, so clients reload instead of following a broken one.
 */
function buildMeta(prevMeta, catalog, delta) {
  const hash = structHash(catalog);
  let chain = [];
  if (delta) {
    const old = Array.isArray(prevMeta?.deltas) ? prevMeta.deltas : [];
    const continues = old.length === 0 || old[old.length - 1].to === delta.from;
    chain = (continues ? old : []).concat({
      from: delta.from,
      to: delta.to,
      key: deltaKeyFor(delta.to),
      n: delta.changes.length,
    });
  }
  return {
    v: META_VERSION,
    generatedAt: catalog.generatedAt,
    structHash: hash,
    deltas: chain.slice(-MAX_CHAIN),
  };
}

/**
 * Everything one upload needs from the previous baseline and the new catalog.
 * @returns {{ meta: object, delta: object|null, deltaKey: string|null, state: object, reason: string|null }}
 */
function planLiveUpdate(baseline, catalog, options) {
  const { delta, reason } = diffCatalogs(baseline, catalog, options);
  const state = stateOf(catalog);
  if (reason === 'same build' && baseline.meta) {
    return { meta: baseline.meta, delta: null, deltaKey: null, state, reason };
  }
  const meta = buildMeta(baseline?.meta, catalog, delta);
  return { meta, delta, deltaKey: delta ? deltaKeyFor(delta.to) : null, state, reason: reason ?? null };
}

module.exports = {
  META_KEY,
  META_VERSION,
  DELTA_VERSION,
  DELTA_KEY_RE,
  MAX_CHAIN,
  MAX_CHANGED_SHARE,
  VOLATILE_FIELDS,
  stampOf,
  deltaKeyFor,
  structHash,
  stateOf,
  diffCatalogs,
  buildMeta,
  planLiveUpdate,
};
