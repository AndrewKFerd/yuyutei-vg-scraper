'use strict';

/**
 * Pure price-history logic shared by record-history.js, backfill-history.js
 * and build-data.js -- no file or network IO in here, so every recording
 * rule is unit-testable (see test/price-history.test.js).
 *
 * yuyu-tei doesn't publish price history, and each refresh used to
 * overwrite cards.json, so any run that isn't recorded here is lost for
 * good. The canonical history is a change log, not a series of snapshots:
 * a listing gets a new [minute, price, stock] entry only when its price or
 * stock differs from its last entry (~150 events/day across 28k listings,
 * vs 28k rows x 48 runs/day for full snapshots).
 *
 * Units: time is integer minutes since the Unix epoch everywhere in these
 * files, prices are integer JPY, and stock is an integer >= 0 or null
 * (yuyu-tei's "◯" always-available marker -- in stock, no count). Listing
 * ids are build-data.js's composite `${setSlug}/${id}`.
 */

const crypto = require('crypto');
const { groupKey } = require('./card-group');

const HISTORY_VERSION = 1;

// A price move of x5 or more (either direction) is held back until the next
// run repeats it -- parsePrice takes the first number it finds, so a markup
// change on yuyu-tei's side could otherwise record a bogus 10x spike.
const JUMP_FACTOR = 5;

// When more than this share (and more than MASS_RENAME_MIN) of listings
// change name in one run, it's the scraper or yuyu-tei's markup changing
// (e.g. a new variant-suffix format), not hundreds of product numbers being
// reused at once -- so the stored hashes are updated rather than every
// series being closed.
const MASS_RENAME_FRACTION = 0.05;
const MASS_RENAME_MIN = 20;

// The run gate's baseline is the largest catalog seen over this window, so
// a slow leak (each run a little under the last, each within the gate's
// tolerance) can't ratchet the baseline down unnoticed.
const RECENT_COUNTS_MINUTES = 7 * 1440;

// Content gate (checkObservationSanity). Every committed snapshot and the
// current catalog have 0 unparsed prices, so losing 10% means the price
// markup changed. And a normal run changes a few percent of listings -- the
// Sep 28 run after a 10-day gap changed ~5.4% -- so a quarter of them
// changing at once means the scraper is misreading the page (e.g. every
// stock parsing as 0), not that the market moved.
const MIN_PRICED_SHARE = 0.9;
const MAX_CHANGED_SHARE = 0.25;
const MASS_CHANGE_ENV = 'ALLOW_MASS_CHANGE';

// The refresh runs every 30 min when the PC is on. Runs up to 75 min apart
// (i.e. at most one or two skipped slots) count as continuous coverage;
// anything longer is a gap the UI shades as "not observed".
const COVERAGE_GAP_MINUTES = 75;

const WINDOWS = { '24h': 1440, '7d': 10080, '30d': 43200 };
const CHG7D_WINDOW_MINUTES = WINDOWS['7d'];
const MOVERS_CAPS = { priceChanges: 300, soldOut: 200, restocked: 200, sellingFast: 50 };

function toMinute(ms) {
  return Math.floor(ms / 60000);
}

function minuteToIso(minute) {
  return Number.isFinite(minute) ? new Date(minute * 60000).toISOString() : null;
}

/**
 * First 8 hex chars of sha1 over the normalized name. NFKC + whitespace
 * stripping so a full-width/half-width or spacing tweak on yuyu-tei's side
 * isn't mistaken for a product number being reused for a different card.
 */
function nameHash(nameJp) {
  const normalized = String(nameJp ?? '').normalize('NFKC').replace(/\s+/g, '');
  return crypto.createHash('sha1').update(normalized, 'utf8').digest('hex').slice(0, 8);
}

function isInStock(stock) {
  return stock === null || stock > 0;
}

function createEmptyHistory() {
  return {
    v: HISTORY_VERSION,
    trackingSince: null,
    lastGoodCount: null,
    runs: [],
    cards: {},
    names: {},
    pending: {},
    retired: {},
    pendingRenames: {},
    recentCounts: [],
  };
}

/**
 * Validates a parsed price-history.json and fills in any optional maps it
 * lacks. Throws on anything that doesn't look like a v1 history -- callers
 * must never fall back to a fresh history over a file they couldn't read.
 */
function normalizeHistory(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('price history is not a JSON object');
  }
  if (obj.v !== HISTORY_VERSION) {
    throw new Error(`unsupported price history version ${JSON.stringify(obj.v)} (expected ${HISTORY_VERSION})`);
  }
  if (!Array.isArray(obj.runs)) throw new Error('price history has no runs array');
  if (!obj.cards || typeof obj.cards !== 'object' || Array.isArray(obj.cards)) {
    throw new Error('price history has no cards map');
  }
  obj.trackingSince ??= obj.runs.length ? obj.runs[0] : null;
  obj.lastGoodCount ??= null;
  obj.names ??= {};
  obj.pending ??= {};
  obj.retired ??= {};
  obj.pendingRenames ??= {};
  obj.recentCounts ??= [];
  return obj;
}

/**
 * The record-history run gate's baseline: the largest raw catalog count
 * among the runs of the last 7 days (recentCounts), else lastGoodCount.
 */
function gateBaseline(history) {
  const counts = (history.recentCounts || []).map(([, n]) => n).filter(Number.isFinite);
  return counts.length ? Math.max(...counts) : history.lastGoodCount ?? null;
}

/** catalog-raw.json records -> observations (raw ids are per-set, so compose them). */
function observationsFromCatalog(rawCards) {
  return rawCards.map((c) => ({
    id: `${c.setSlug}/${c.id}`,
    nameJp: c.nameJp,
    setCode: c.setCode,
    price: c.price,
    stock: c.stock,
  }));
}

/** Built cards.json records (ids already composite) -> observations. */
function observationsFromBuiltCards(cards) {
  return cards.map((c) => ({
    id: c.id,
    nameJp: c.nameJp,
    setCode: c.setCode,
    price: c.price,
    stock: c.stock,
  }));
}

function emptyStats(skipped) {
  return {
    skipped,
    newCards: 0,
    priceChanges: 0,
    stockChanges: 0,
    pendingJumps: 0,
    confirmedJumps: 0,
    renamed: 0,
    pendingRenames: 0,
    massRename: false,
  };
}

/**
 * id -> { price, stock, nameJp } for the listings actually observed this
 * run: a listing whose price didn't parse wasn't really observed (recording
 * it would crash the series or fake a change), a missing stock is stored as
 * null, and the first occurrence wins on a duplicate id so one run can
 * never append twice to a series.
 */
function collectObserved(observations) {
  const observed = new Map();
  for (const o of observations) {
    if (!o || !Number.isFinite(o.price) || observed.has(o.id)) continue;
    observed.set(o.id, { price: o.price, stock: o.stock === undefined ? null : o.stock, nameJp: o.nameJp });
  }
  return observed;
}

/**
 * Content gate, checked before appendObservation: the run gate only counts
 * listings, so a scrape where the markup changed under us (prices failing
 * to parse, every stock reading as 0) would pass it and then be recorded as
 * thousands of real changes. Fails when
 *   (i)  fewer than 90% of the raw catalog's listings have a finite price, or
 *   (ii) more than 25% of the observed listings that already have a series
 *        differ in price or stock from their last entry,
 * unless allowMassChange (ALLOW_MASS_CHANGE=1).
 *
 * @returns {{ok, overridden, message, priced, comparable, changed}}
 */
function checkObservationSanity(history, observations, rawCount, {
  minPricedShare = MIN_PRICED_SHARE,
  maxChangedShare = MAX_CHANGED_SHARE,
  allowMassChange = false,
} = {}) {
  const observed = collectObserved(observations);
  const priced = observed.size;
  let comparable = 0;
  let changed = 0;
  for (const [id, { price, stock }] of observed) {
    const series = history.cards[id];
    if (!series || !series.length) continue;
    comparable++;
    const [, lp, ls] = series[series.length - 1];
    if (price !== lp || stock !== ls) changed++;
  }

  const problems = [];
  if (rawCount > 0 && priced < rawCount * minPricedShare) {
    problems.push(
      `only ${priced} of ${rawCount} listings have a parseable price ` +
      `(below ${Math.round(minPricedShare * 100)}%)`
    );
  }
  if (comparable > 0 && changed > comparable * maxChangedShare) {
    problems.push(
      `${changed} of ${comparable} already-tracked listings (${(100 * changed / comparable).toFixed(1)}%) ` +
      `changed price or stock since their last entry (limit ${Math.round(maxChangedShare * 100)}%)`
    );
  }
  const stats = { priced, comparable, changed };
  if (!problems.length) return { ok: true, overridden: false, message: null, ...stats };
  const detail = `Catalog content looks wrong: ${problems.join('; ')}`;
  if (allowMassChange) {
    return { ok: true, overridden: true, message: `${detail} -- recording anyway because ${MASS_CHANGE_ENV}=1.`, ...stats };
  }
  return {
    ok: false,
    overridden: false,
    message: `${detail} -- refusing to record it, this looks like the scraper misreading yuyu-tei's ` +
      `pages. If the change is real, rerun with ${MASS_CHANGE_ENV}=1.`,
    ...stats,
  };
}

function allowMassChangeFromEnv(env = process.env) {
  return env[MASS_CHANGE_ENV] === '1';
}

function isImplausibleJump(lastPrice, price) {
  return lastPrice > 0 && (price >= lastPrice * JUMP_FACTOR || price * JUMP_FACTOR <= lastPrice);
}

/**
 * Records one observation run into `history` (mutated in place; no IO).
 *
 * @param {object} history  a normalized v1 history (see createEmptyHistory)
 * @param {Array<{id, nameJp, setCode, price, stock}>} observations  one per listing in this run's catalog
 * @param {number} observedAt  run time, integer minutes since epoch
 * @param {{rawCount?: number, resetCountBaseline?: boolean}} [opts]  rawCount = the catalog's card
 *   count before any filtering (the run-gate baseline for later runs; defaults to
 *   observations.length); resetCountBaseline = this run's shrink was accepted on purpose
 *   (ALLOW_CATALOG_SHRINK=1), so recentCounts restarts from it
 * @returns {{skipped, newCards, priceChanges, stockChanges, pendingJumps, confirmedJumps, renamed,
 *   pendingRenames, massRename}}  `renamed` = listings renamed this run: series retired after a
 *   confirmed rename, or (with `massRename`) merely re-hashed; `pendingRenames` = renames seen
 *   for the first time and held for confirmation.
 */
function appendObservation(history, observations, observedAt, { rawCount, resetCountBaseline = false } = {}) {
  if (!Number.isInteger(observedAt)) {
    throw new TypeError(`observedAt must be an integer minute, got ${observedAt}`);
  }
  const { runs, cards, names, pending, retired } = history;
  const pendingRenames = (history.pendingRenames ??= {});

  // 1. Idempotent: re-running on the same (or an older) catalog is a no-op,
  //    so a retried refresh can never record a run twice or out of order.
  if (runs.length && observedAt <= runs[runs.length - 1]) return emptyStats(true);

  const stats = emptyStats(false);

  // 2. Only listings with a finite price count as observed this run.
  const observed = collectObserved(observations);
  for (const o of observed.values()) o.hash = nameHash(o.nameJp);

  // 3. Rename check: yuyu-tei reuses per-set product numbers, and splicing a
  //    different card onto an old series would fabricate a price move.
  const renamedIds = [];
  let withStoredName = 0;
  for (const [id, o] of observed) {
    if (names[id] === undefined) continue;
    withStoredName++;
    if (names[id] !== o.hash) renamedIds.push(id);
    // Back to the stored name: the earlier different name was a one-off.
    else delete pendingRenames[id];
  }
  const unobservedIds = new Set();
  const retiredIds = new Set();
  if (renamedIds.length > withStoredName * MASS_RENAME_FRACTION && renamedIds.length > MASS_RENAME_MIN) {
    stats.massRename = true;
    stats.renamed = renamedIds.length;
    for (const id of renamedIds) {
      names[id] = observed.get(id).hash;
      delete pendingRenames[id];
    }
  } else {
    for (const id of renamedIds) {
      const hash = observed.get(id).hash;
      if (pendingRenames[id] === hash) {
        // The next observation kept the new name, so it really is a
        // different card now: close the old series (the fresh one is
        // started by the new-id branch below).
        if (cards[id]) retired[`${id}@${observedAt}`] = cards[id];
        delete cards[id];
        delete pending[id];
        delete pendingRenames[id];
        retiredIds.add(id);
        stats.renamed++;
      } else {
        // First sighting of this name (a third name replaces a pending
        // one): hold it, and skip the listing this run rather than guess
        // which card its price belongs to.
        pendingRenames[id] = hash;
        unobservedIds.add(id);
        stats.pendingRenames++;
      }
    }
  }

  for (const [id, { price: P, stock: S, hash }] of observed) {
    if (unobservedIds.has(id)) continue;
    const series = cards[id];

    // 4. New listing (or a renamed one restarting): its first entry.
    if (!series || series.length === 0) {
      cards[id] = [[observedAt, P, S]];
      names[id] = hash;
      if (!retiredIds.has(id)) stats.newCards++;
      continue;
    }
    names[id] ??= hash;

    // 5. Existing listing.
    const [, lp, ls] = series[series.length - 1];
    if (isImplausibleJump(lp, P)) {
      const p = pending[id];
      if (p && p.price === P) {
        // Two consecutive observations agree, so it's real: stamp it with
        // the run that first saw it, not this confirming run.
        series.push([p.at, P, p.stock]);
        stats.confirmedJumps++;
        stats.priceChanges++;
        if (S !== p.stock) {
          series.push([observedAt, P, S]);
          stats.stockChanges++;
        }
        delete pending[id];
      } else {
        // Hold it (stock change included) until the next run repeats it.
        pending[id] = { at: observedAt, price: P, stock: S };
        stats.pendingJumps++;
      }
      continue;
    }

    // A pending jump that the next observation didn't repeat was a glitch.
    delete pending[id];
    if (P !== lp || S !== ls) {
      series.push([observedAt, P, S]);
      if (P !== lp) stats.priceChanges++;
      else stats.stockChanges++;
    }
  }

  // 6. Listings in history but absent from this run are left untouched: a
  //    skipped catalog page is not a sell-out.

  // 7. Bookkeeping.
  const count = Number.isFinite(rawCount) ? rawCount : observations.length;
  runs.push(observedAt);
  history.lastGoodCount = count;
  history.recentCounts = resetCountBaseline
    ? []
    : (history.recentCounts || []).filter(([t]) => t > observedAt - RECENT_COUNTS_MINUTES);
  history.recentCounts.push([observedAt, count]);
  history.trackingSince ??= observedAt;
  return stats;
}

/** Last entry with minute <= t, or null if the series starts after t. */
function entryAt(series, t) {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i][0] <= t) return series[i];
  }
  return null;
}

/** Minute of the most recent entry whose price differs from the entry before it (null if never changed). */
function lastPriceChangeAt(series) {
  for (let i = series.length - 1; i >= 1; i--) {
    if (series[i][1] !== series[i - 1][1]) return series[i][0];
  }
  return null;
}

/**
 * Merges ascending run minutes into [start, end] spans of continuous
 * coverage; a lone run is [t, t].
 */
function buildCoverage(runs, maxGapMinutes = COVERAGE_GAP_MINUTES) {
  const spans = [];
  for (const t of runs) {
    const last = spans[spans.length - 1];
    if (last && t - last[1] <= maxGapMinutes) last[1] = t;
    else spans.push([t, t]);
  }
  return spans;
}

/**
 * history-public.json: the served subset. Listings whose only entry is the
 * tracking-start baseline are dropped -- the UI reads "absent" as
 * "unchanged since tracking began", which keeps the file to the few
 * thousand listings that actually moved. names/pending/retired/runs stay
 * private.
 */
function buildPublicHistory(history, { generatedAt = new Date().toISOString() } = {}) {
  const { trackingSince, runs } = history;
  const cards = {};
  for (const [id, series] of Object.entries(history.cards)) {
    if (!series.length) continue;
    if (series.length > 1 || series[0][0] > trackingSince) cards[id] = series;
  }
  return {
    v: HISTORY_VERSION,
    generatedAt,
    trackingSince: trackingSince ?? null,
    lastRun: runs.length ? runs[runs.length - 1] : null,
    coverage: buildCoverage(runs),
    cards,
  };
}

// Deterministic tie-breaks so an unchanged history always produces the
// same leaderboards (and the caps cut at the same place).
function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function changeRatio(from, to) {
  if (from === 0) return to === 0 ? 0 : Infinity;
  return Math.abs(to - from) / from;
}

function moversForWindow(entries, trackingSince, since) {
  const priceChanges = [];
  const soldOut = [];
  const restocked = [];
  const sellingFast = [];
  const complete = Number.isFinite(trackingSince) && trackingSince <= since;
  // A window reaching back before tracking began (complete: false) is
  // measured from the tracking-start baseline instead -- otherwise its
  // price lists would stay empty for the first 30 days while its other
  // sections (which only need pairs inside the window) fill up.
  const baseAt = complete || !Number.isFinite(trackingSince) ? since : trackingSince;

  for (const { id, g, series } of entries) {
    const latest = series[series.length - 1];
    const [, latestPrice, latestStock] = latest;

    // Price change across the window, measured from the price in effect at
    // its start -- a listing first seen inside the window has no baseline.
    const base = entryAt(series, baseAt);
    if (base && base[1] !== latestPrice) {
      priceChanges.push({ id, g, from: base[1], to: latestPrice, at: lastPriceChangeAt(series) });
    }

    // Walk the consecutive pairs whose later entry falls inside the window
    // (the earlier one may be the entry in effect at `since`), newest first.
    let soldOutAt = null;
    let restockedAt = null;
    let sold = 0;
    for (let i = series.length - 1; i >= 1 && series[i][0] > since; i--) {
      const [curAt, , curStock] = series[i];
      const prevStock = series[i - 1][2];
      if (soldOutAt === null && curStock === 0 && isInStock(prevStock)) soldOutAt = curAt;
      if (restockedAt === null && prevStock === 0 && isInStock(curStock)) restockedAt = curAt;
      // Only counted stock tells us about sales; restocks (increases) and
      // the "◯" marker (null) are ignored.
      if (typeof prevStock === 'number' && typeof curStock === 'number' && curStock < prevStock) {
        sold += prevStock - curStock;
      }
    }
    if (latestStock === 0 && soldOutAt !== null) {
      soldOut.push({ id, g, at: soldOutAt, price: latestPrice });
    }
    if (isInStock(latestStock) && restockedAt !== null) {
      restocked.push({ id, g, at: restockedAt, stock: latestStock, price: latestPrice });
    }
    if (sold >= 1) {
      sellingFast.push({ id, g, sold, stock: latestStock, price: latestPrice });
    }
  }

  priceChanges.sort((a, b) =>
    changeRatio(b.from, b.to) - changeRatio(a.from, a.to) ||
    Math.abs(b.to - b.from) - Math.abs(a.to - a.from) ||
    byId(a, b));
  const byRecent = (a, b) => b.at - a.at || b.price - a.price || byId(a, b);
  soldOut.sort(byRecent);
  restocked.sort(byRecent);
  sellingFast.sort((a, b) => b.sold - a.sold || b.price - a.price || byId(a, b));

  return {
    since,
    // Whether the history reaches back to the start of the window.
    complete,
    priceChanges: priceChanges.slice(0, MOVERS_CAPS.priceChanges),
    soldOut: soldOut.slice(0, MOVERS_CAPS.soldOut),
    restocked: restocked.slice(0, MOVERS_CAPS.restocked),
    sellingFast: sellingFast.slice(0, MOVERS_CAPS.sellingFast),
  };
}

/**
 * movers.json: precomputed leaderboards for the 24h/7d/30d windows ending at
 * the last run. Only listings present in the latest catalog are eligible
 * (`currentListings` = this run's observations, which carry the setCode +
 * nameJp groupKey needs). No price floor here -- the frontend applies it.
 */
function buildMovers(history, currentListings, { generatedAt = new Date().toISOString() } = {}) {
  const { runs, trackingSince } = history;
  const asOf = runs.length ? runs[runs.length - 1] : null;

  const entries = [];
  const seen = new Set();
  for (const rec of currentListings) {
    if (!rec || seen.has(rec.id)) continue;
    seen.add(rec.id);
    const series = history.cards[rec.id];
    if (!series || !series.length) continue;
    entries.push({ id: rec.id, g: groupKey(rec), series });
  }

  const windows = {};
  for (const [name, minutes] of Object.entries(WINDOWS)) {
    windows[name] = asOf === null
      ? { since: null, complete: false, priceChanges: [], soldOut: [], restocked: [], sellingFast: [] }
      : moversForWindow(entries, trackingSince, asOf - minutes);
  }
  return { v: HISTORY_VERSION, generatedAt, asOf, windows };
}

/**
 * cards.json's optional chg7d: the price in effect 7 days before the last
 * run, if it differs from the latest recorded price -- and only when that
 * latest price is also what the card shows now (they can disagree while an
 * implausible jump is pending confirmation). Returns null to omit the field.
 */
function computeChg7d(series, asOf, cardPrice) {
  if (!series || !series.length || !Number.isFinite(asOf)) return null;
  const base = entryAt(series, asOf - CHG7D_WINDOW_MINUTES);
  const latest = series[series.length - 1];
  if (!base || base[1] === latest[1] || latest[1] !== cardPrice) return null;
  return { from: base[1], at: lastPriceChangeAt(series) };
}

module.exports = {
  HISTORY_VERSION,
  JUMP_FACTOR,
  MASS_RENAME_FRACTION,
  MASS_RENAME_MIN,
  RECENT_COUNTS_MINUTES,
  MIN_PRICED_SHARE,
  MAX_CHANGED_SHARE,
  COVERAGE_GAP_MINUTES,
  WINDOWS,
  MOVERS_CAPS,
  toMinute,
  minuteToIso,
  nameHash,
  isInStock,
  createEmptyHistory,
  normalizeHistory,
  gateBaseline,
  checkObservationSanity,
  allowMassChangeFromEnv,
  observationsFromCatalog,
  observationsFromBuiltCards,
  appendObservation,
  entryAt,
  lastPriceChangeAt,
  buildCoverage,
  buildPublicHistory,
  buildMovers,
  computeChg7d,
};
