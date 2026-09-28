'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createEmptyHistory,
  buildCoverage,
  buildPublicHistory,
  buildMovers,
  computeChg7d,
  entryAt,
  lastPriceChangeAt,
  WINDOWS,
  MOVERS_CAPS,
} = require('../price-history');
const { groupKey } = require('../card-group');

const DAY = 1440;
const ASOF = 29843252;
const TRACK = ASOF - 40 * DAY; // history covers all three windows
const SINCE_24H = ASOF - WINDOWS['24h'];
const SINCE_7D = ASOF - WINDOWS['7d'];

/** A history whose runs span TRACK..ASOF, with the given series. */
function historyWith(cards, { trackingSince = TRACK, runs } = {}) {
  const h = createEmptyHistory();
  h.trackingSince = trackingSince;
  h.runs = runs || [trackingSince, ASOF];
  h.cards = cards;
  return h;
}

function listing(id, nameJp = `カード${id}`, setCode = 'DZ-BT01/001') {
  return { id, nameJp, setCode, price: 1, stock: 1 };
}

function listingsFor(cards) {
  return Object.keys(cards).map((id) => listing(id));
}

function movers(cards, opts) {
  return buildMovers(historyWith(cards, opts), listingsFor(cards), { generatedAt: 'GEN' });
}

describe('entryAt / lastPriceChangeAt', () => {
  const s = [[10, 100, 1], [20, 200, 1], [30, 200, 0]];
  it('entryAt returns the last entry with minute <= t', () => {
    assert.equal(entryAt(s, 9), null);
    assert.deepEqual(entryAt(s, 10), s[0]);
    assert.deepEqual(entryAt(s, 25), s[1]);
    assert.deepEqual(entryAt(s, 99), s[2]);
  });
  it('lastPriceChangeAt skips stock-only entries', () => {
    assert.equal(lastPriceChangeAt(s), 20);
    assert.equal(lastPriceChangeAt([[10, 100, 1], [20, 100, 0]]), null);
  });
});

describe('buildCoverage', () => {
  it('handles no runs and a lone run', () => {
    assert.deepEqual(buildCoverage([]), []);
    assert.deepEqual(buildCoverage([100]), [[100, 100]]);
  });

  it('merges runs up to 75 minutes apart into one span, splits beyond that', () => {
    assert.deepEqual(buildCoverage([0, 30, 60, 135, 211, 241, 1000]), [[0, 135], [211, 241], [1000, 1000]]);
  });

  it('treats exactly 75 minutes as continuous and 76 as a gap', () => {
    assert.deepEqual(buildCoverage([0, 75]), [[0, 75]]);
    assert.deepEqual(buildCoverage([0, 76]), [[0, 0], [76, 76]]);
  });
});

describe('buildPublicHistory', () => {
  const h = historyWith({
    'a/unchanged': [[TRACK, 100, 1]],
    'a/changed': [[TRACK, 100, 1], [ASOF, 120, 1]],
    'a/later': [[TRACK + 30, 50, null]],
  }, { runs: [TRACK, TRACK + 30, ASOF] });
  h.names = { 'a/unchanged': 'deadbeef' };
  h.pending = { 'a/unchanged': { at: ASOF, price: 999, stock: 1 } };
  h.retired = { [`a/x@${ASOF}`]: [[TRACK, 1, 1]] };
  h.lastGoodCount = 28235;
  h.pendingRenames = { 'a/changed': 'cafebabe' };
  h.recentCounts = [[ASOF, 28235]];
  const pub = buildPublicHistory(h, { generatedAt: '2026-09-28T12:12:10.698Z' });

  it('has exactly the served fields (no names/pending/retired/runs/lastGoodCount/pendingRenames/recentCounts)', () => {
    assert.deepEqual(Object.keys(pub), ['v', 'generatedAt', 'trackingSince', 'lastRun', 'coverage', 'cards']);
    assert.equal(pub.v, 1);
    assert.equal(pub.generatedAt, '2026-09-28T12:12:10.698Z');
    assert.equal(pub.trackingSince, TRACK);
    assert.equal(pub.lastRun, ASOF);
    assert.deepEqual(pub.coverage, [[TRACK, TRACK + 30], [ASOF, ASOF]]);
  });

  it('includes listings with >1 entry or first seen after trackingSince, omits baseline-only ones', () => {
    assert.deepEqual(pub.cards, {
      'a/changed': [[TRACK, 100, 1], [ASOF, 120, 1]],
      'a/later': [[TRACK + 30, 50, null]],
    });
  });

  it('handles an empty history', () => {
    const empty = buildPublicHistory(createEmptyHistory(), { generatedAt: 'x' });
    assert.deepEqual(empty, { v: 1, generatedAt: 'x', trackingSince: null, lastRun: null, coverage: [], cards: {} });
  });
});

describe('buildMovers', () => {
  it('has the documented shape', () => {
    const m = movers({ 'a/1': [[TRACK, 100, 1]] });
    assert.deepEqual(Object.keys(m), ['v', 'generatedAt', 'asOf', 'windows']);
    assert.equal(m.v, 1);
    assert.equal(m.generatedAt, 'GEN');
    assert.equal(m.asOf, ASOF);
    assert.deepEqual(Object.keys(m.windows), ['24h', '7d', '30d']);
    for (const [name, w] of Object.entries(m.windows)) {
      assert.deepEqual(Object.keys(w), ['since', 'complete', 'priceChanges', 'soldOut', 'restocked', 'sellingFast']);
      assert.equal(w.since, ASOF - WINDOWS[name]);
    }
  });

  describe('complete flag', () => {
    it('is true only when trackingSince <= since', () => {
      const m = movers({ 'a/1': [[ASOF - 7 * DAY, 100, 1]] }, { trackingSince: ASOF - 7 * DAY });
      assert.equal(m.windows['24h'].complete, true);
      assert.equal(m.windows['7d'].complete, true); // equality counts
      assert.equal(m.windows['30d'].complete, false);
    });
  });

  describe('priceChanges', () => {
    it('reports from (price in effect at since), to (latest), at (most recent price change)', () => {
      const m = movers({
        'a/1': [[TRACK, 7980, 3], [ASOF - 2 * DAY, 9980, 3], [ASOF - DAY / 2, 9980, 0]],
      });
      const [e] = m.windows['7d'].priceChanges;
      assert.deepEqual(e, { id: 'a/1', g: groupKey(listing('a/1')), from: 7980, to: 9980, at: ASOF - 2 * DAY });
      // 24h: in effect at since was already 9980 -> no change in that window.
      assert.deepEqual(m.windows['24h'].priceChanges, []);
    });

    it('window boundary: a change exactly at since is the baseline, one minute later is inside', () => {
      const atSince = movers({ 'a/1': [[TRACK, 100, 1], [SINCE_24H, 150, 1]] });
      assert.deepEqual(atSince.windows['24h'].priceChanges, []);
      const inside = movers({ 'a/1': [[TRACK, 100, 1], [SINCE_24H + 1, 150, 1]] });
      assert.equal(inside.windows['24h'].priceChanges.length, 1);
      assert.equal(inside.windows['24h'].priceChanges[0].at, SINCE_24H + 1);
    });

    it('partial window (since < trackingSince): measures from the tracking-start baseline', () => {
      const tracking = ASOF - 13 * DAY;
      const m = movers({
        'a/tracked': [[tracking, 500, 2], [ASOF - 10 * DAY, 600, 2], [ASOF, 1480, 1]],
        'a/later': [[tracking + 30, 100, 1], [ASOF, 300, 1]], // first seen after tracking began: no baseline
      }, { trackingSince: tracking });
      const w = m.windows['30d'];
      assert.equal(w.complete, false);
      assert.equal(w.since, ASOF - WINDOWS['30d']);
      assert.deepEqual(w.priceChanges, [
        { id: 'a/tracked', g: groupKey(listing('a/tracked')), from: 500, to: 1480, at: ASOF },
      ]);
      // A complete window still uses the price in effect at `since` (and
      // 'a/later', seen 13 days ago, has one there).
      assert.deepEqual(m.windows['7d'].priceChanges.map((e) => [e.id, e.from]), [['a/later', 100], ['a/tracked', 600]]);
    });

    it('skips listings with no baseline (first seen inside the window)', () => {
      const m = movers({ 'a/1': [[ASOF - 60, 100, 1], [ASOF, 200, 1]] });
      assert.deepEqual(m.windows['24h'].priceChanges, []);
      assert.equal(m.windows['24h'].sellingFast.length, 0);
    });

    it('skips a price that moved and came back within the window', () => {
      const m = movers({ 'a/1': [[TRACK, 100, 1], [ASOF - 60, 150, 1], [ASOF, 100, 1]] });
      assert.deepEqual(m.windows['24h'].priceChanges, []);
    });

    it('only includes listings present in the latest catalog', () => {
      const h = historyWith({
        'a/listed': [[TRACK, 100, 1], [ASOF, 150, 1]],
        'a/delisted': [[TRACK, 100, 1], [ASOF - 60, 900, 1]],
      });
      const m = buildMovers(h, [listing('a/listed')]);
      assert.deepEqual(m.windows['24h'].priceChanges.map((e) => e.id), ['a/listed']);
    });

    it('computes g from the current catalog record', () => {
      const h = historyWith({ 'dz/1': [[TRACK, 100, 1], [ASOF, 150, 1]] });
      const m = buildMovers(h, [listing('dz/1', 'ブラスター・ブレード(箔押し)', 'DZ-BT14/FFR01')]);
      assert.equal(m.windows['24h'].priceChanges[0].g, 'DZ|ブラスター・ブレード');
    });

    it('sorts by |to-from|/from descending, drops included', () => {
      const m = movers({
        'a/small': [[TRACK, 1000, 1], [ASOF, 1100, 1]], // +10%
        'a/drop': [[TRACK, 1280, 1], [ASOF, 420, 1]], // -67%
        'a/rise': [[TRACK, 500, 1], [ASOF, 1480, 1]], // +196%
        'a/mid': [[TRACK, 7980, 1], [ASOF, 9980, 1]], // +25%
      });
      assert.deepEqual(m.windows['7d'].priceChanges.map((e) => e.id), ['a/rise', 'a/drop', 'a/mid', 'a/small']);
    });

    it(`caps at ${MOVERS_CAPS.priceChanges}`, () => {
      const cards = {};
      for (let i = 0; i < 310; i++) cards[`a/${i}`] = [[TRACK, 1000, 1], [ASOF, 1001 + i, 1]];
      const list = movers(cards).windows['7d'].priceChanges;
      assert.equal(list.length, 300);
      assert.equal(list[0].id, 'a/309');
    });
  });

  describe('soldOut', () => {
    it('includes listings now at 0 that went out of stock inside the window; at = latest sell-out', () => {
      const m = movers({
        'a/1': [[TRACK, 1480, 2], [ASOF - 600, 1480, 0], [ASOF - 300, 1480, 1], [ASOF - 100, 1480, 0]],
        'a/null': [[TRACK, 500, null], [ASOF - 50, 600, 0]],
      });
      assert.deepEqual(m.windows['24h'].soldOut, [
        { id: 'a/null', g: groupKey(listing('a/null')), at: ASOF - 50, price: 600 },
        { id: 'a/1', g: groupKey(listing('a/1')), at: ASOF - 100, price: 1480 },
      ]);
    });

    it('excludes a sell-out at or before since, and listings back in stock', () => {
      const m = movers({
        'a/old': [[TRACK, 100, 2], [SINCE_24H, 100, 0]],
        'a/back': [[TRACK, 100, 2], [ASOF - 100, 100, 0], [ASOF, 100, 3]],
        'a/never': [[TRACK, 100, 0], [ASOF - 10, 120, 0]],
      });
      assert.deepEqual(m.windows['24h'].soldOut, []);
      assert.deepEqual(m.windows['7d'].soldOut.map((e) => e.id), ['a/old']);
    });

    it(`sorts by at descending and caps at ${MOVERS_CAPS.soldOut}`, () => {
      const cards = {};
      for (let i = 0; i < 210; i++) cards[`a/${i}`] = [[TRACK, 100, 1], [ASOF - 1000 + i, 100, 0]];
      const list = movers(cards).windows['24h'].soldOut;
      assert.equal(list.length, 200);
      assert.equal(list[0].at, ASOF - 1000 + 209);
      for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].at >= list[i].at);
    });
  });

  describe('restocked', () => {
    it('includes listings now in stock that came back from 0 inside the window', () => {
      const m = movers({
        'a/1': [[TRACK, 1480, 0], [ASOF - 200, 1480, 4]],
        'a/null': [[TRACK, 30, 0], [ASOF - 100, 30, null]],
        'a/still-out': [[TRACK, 30, 2], [ASOF - 150, 30, 0]],
        'a/old': [[TRACK, 30, 0], [SINCE_24H, 30, 2]],
      });
      assert.deepEqual(m.windows['24h'].restocked, [
        { id: 'a/null', g: groupKey(listing('a/null')), at: ASOF - 100, stock: null, price: 30 },
        { id: 'a/1', g: groupKey(listing('a/1')), at: ASOF - 200, stock: 4, price: 1480 },
      ]);
    });

    it('reports the latest stock and price, and the latest restock', () => {
      const m = movers({
        'a/1': [[TRACK, 100, 0], [ASOF - 500, 100, 2], [ASOF - 400, 100, 0], [ASOF - 300, 100, 5], [ASOF - 10, 150, 3]],
      });
      assert.deepEqual(m.windows['24h'].restocked, [
        { id: 'a/1', g: groupKey(listing('a/1')), at: ASOF - 300, stock: 3, price: 150 },
      ]);
    });

    it(`caps at ${MOVERS_CAPS.restocked}`, () => {
      const cards = {};
      for (let i = 0; i < 205; i++) cards[`a/${i}`] = [[TRACK, 100, 0], [ASOF - 500 + i, 100, 1]];
      assert.equal(movers(cards).windows['24h'].restocked.length, 200);
    });
  });

  describe('sellingFast', () => {
    it('sums stock decreases inside the window, ignoring increases and null stocks', () => {
      const m = movers({
        // In effect at since: 8. Inside: 8->5 (3), 5->9 restock (ignored), 9->6 (3), 6->null, null->2 (ignored).
        'a/1': [[TRACK, 980, 10], [SINCE_24H - 100, 980, 8], [ASOF - 500, 980, 5], [ASOF - 400, 980, 9],
          [ASOF - 300, 980, 6], [ASOF - 200, 980, null], [ASOF - 100, 980, 2]],
      });
      assert.deepEqual(m.windows['24h'].sellingFast, [
        { id: 'a/1', g: groupKey(listing('a/1')), sold: 6, stock: 2, price: 980 },
      ]);
      // 7d also counts the 10->8 drop before the 24h window.
      assert.equal(m.windows['7d'].sellingFast[0].sold, 8);
    });

    it('counts the pair whose earlier entry is the one in effect at since, not pairs ending at since', () => {
      const m = movers({
        'a/1': [[TRACK, 100, 9], [SINCE_24H, 100, 7], [ASOF - 5, 100, 4]],
      });
      assert.equal(m.windows['24h'].sellingFast[0].sold, 3);
    });

    it('omits listings that sold nothing, and counts a listing first seen inside the window', () => {
      const m = movers({
        'a/up': [[TRACK, 100, 1], [ASOF - 5, 100, 4]],
        'a/new': [[ASOF - 60, 300, 5], [ASOF - 30, 300, 3]],
      });
      assert.deepEqual(m.windows['24h'].sellingFast.map((e) => [e.id, e.sold]), [['a/new', 2]]);
    });

    it(`sorts by sold desc then price desc, caps at ${MOVERS_CAPS.sellingFast}`, () => {
      const cards = {
        'a/cheap': [[TRACK, 100, 5], [ASOF - 5, 100, 2]],
        'a/pricey': [[TRACK, 900, 5], [ASOF - 5, 900, 2]],
        'a/most': [[TRACK, 50, 9], [ASOF - 5, 50, 0]],
      };
      for (let i = 0; i < 60; i++) cards[`b/${i}`] = [[TRACK, 10, 2], [ASOF - 5, 10, 1]];
      const list = movers(cards).windows['24h'].sellingFast;
      assert.equal(list.length, 50);
      assert.deepEqual(list.slice(0, 3).map((e) => e.id), ['a/most', 'a/pricey', 'a/cheap']);
    });
  });

  it('produces empty windows for a history with no runs', () => {
    const m = buildMovers(createEmptyHistory(), [], { generatedAt: 'x' });
    assert.equal(m.asOf, null);
    assert.deepEqual(m.windows['7d'], { since: null, complete: false, priceChanges: [], soldOut: [], restocked: [], sellingFast: [] });
  });
});

describe('computeChg7d', () => {
  it('returns { from, at } when the price moved in the last 7 days and matches the card', () => {
    const s = [[TRACK, 7980, 3], [ASOF - 2 * DAY, 9980, 3], [ASOF - 60, 9980, 0]];
    assert.deepEqual(computeChg7d(s, ASOF, 9980), { from: 7980, at: ASOF - 2 * DAY });
  });

  it('skips when the latest recorded price disagrees with the card (e.g. a pending jump)', () => {
    const s = [[TRACK, 100, 3], [ASOF - DAY, 150, 3]];
    assert.equal(computeChg7d(s, ASOF, 1500), null);
  });

  it('skips when there is no baseline 7 days back', () => {
    assert.equal(computeChg7d([[ASOF - DAY, 100, 1], [ASOF, 150, 1]], ASOF, 150), null);
  });

  it('skips when the price came back to where it was', () => {
    assert.equal(computeChg7d([[TRACK, 100, 1], [ASOF - DAY, 150, 1], [ASOF, 100, 1]], ASOF, 100), null);
  });

  it('treats a change exactly 7 days back as the baseline, one minute later as inside', () => {
    assert.equal(computeChg7d([[TRACK, 100, 1], [SINCE_7D, 150, 1]], ASOF, 150), null);
    assert.deepEqual(computeChg7d([[TRACK, 100, 1], [SINCE_7D + 1, 150, 1]], ASOF, 150), { from: 100, at: SINCE_7D + 1 });
  });

  it('skips stock-only changes and missing input', () => {
    assert.equal(computeChg7d([[TRACK, 100, 1], [ASOF, 100, 0]], ASOF, 100), null);
    assert.equal(computeChg7d(undefined, ASOF, 100), null);
    assert.equal(computeChg7d([[TRACK, 100, 1], [ASOF, 150, 1]], undefined, 150), null);
  });
});
