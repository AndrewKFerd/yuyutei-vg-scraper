'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createEmptyHistory,
  appendObservation,
  nameHash,
  normalizeHistory,
  gateBaseline,
  checkObservationSanity,
  allowMassChangeFromEnv,
  observationsFromCatalog,
  observationsFromBuiltCards,
  toMinute,
} = require('../price-history');

const T0 = 29824708;
const T1 = T0 + 30;
const T2 = T0 + 60;
const T3 = T0 + 90;
const T4 = T0 + 120;

function obs(id, price, stock, nameJp = `カード${id}`, setCode = 'DZ-BT01/001') {
  return { id, nameJp, setCode, price, stock };
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

/** A history with one run at T0 containing the given observations. */
function seeded(observations) {
  const h = createEmptyHistory();
  appendObservation(h, observations, T0);
  return h;
}

describe('nameHash', () => {
  it('is the first 8 hex chars of sha1 over the NFKC-normalized, whitespace-free name', () => {
    const h = nameHash('ブラスター・ブレード');
    assert.match(h, /^[0-9a-f]{8}$/);
    assert.equal(nameHash('ブラスター・ブレード'), h);
  });

  it('ignores whitespace and full-width/half-width differences', () => {
    assert.equal(nameHash('騎士 A (箔押し)'), nameHash('騎士Ａ（箔押し）'));
    assert.equal(nameHash(' 騎士　A\t'), nameHash('騎士A'));
  });

  it('differs for different names', () => {
    assert.notEqual(nameHash('騎士A'), nameHash('騎士B'));
  });
});

describe('observation adapters', () => {
  it('composes catalog-raw ids as setSlug/id', () => {
    const [o] = observationsFromCatalog([
      { id: '10318', setSlug: 'dzbt14', setCode: 'DZ-BT14/FFR01', nameJp: 'x', price: 7980, stock: 3, rarity: 'FFR' },
    ]);
    assert.deepEqual(o, { id: 'dzbt14/10318', nameJp: 'x', setCode: 'DZ-BT14/FFR01', price: 7980, stock: 3 });
  });

  it('keeps built cards.json ids as-is', () => {
    const [o] = observationsFromBuiltCards([
      { id: 'dzbt14/10318', setSlug: 'dzbt14', setCode: 'DZ-BT14/FFR01', nameJp: 'x', price: 7980, stock: null, nameEn: 'y' },
    ]);
    assert.deepEqual(o, { id: 'dzbt14/10318', nameJp: 'x', setCode: 'DZ-BT14/FFR01', price: 7980, stock: null });
  });
});

describe('toMinute', () => {
  it('floors ms to integer minutes since epoch', () => {
    assert.equal(toMinute(Date.parse('2026-09-15T14:28:48.368Z')), 29824708);
    assert.equal(toMinute(60000 * 5 + 59999), 5);
  });
});

describe('normalizeHistory', () => {
  it('fills in missing optional maps', () => {
    const h = normalizeHistory({ v: 1, runs: [5], cards: {} });
    assert.deepEqual(h.names, {});
    assert.deepEqual(h.pending, {});
    assert.deepEqual(h.retired, {});
    assert.equal(h.trackingSince, 5);
    assert.equal(h.lastGoodCount, null);
  });

  it('rejects anything that is not a v1 history', () => {
    assert.throws(() => normalizeHistory(null));
    assert.throws(() => normalizeHistory([]));
    assert.throws(() => normalizeHistory({ v: 2, runs: [], cards: {} }), /version/);
    assert.throws(() => normalizeHistory({ v: 1, cards: {} }), /runs/);
    assert.throws(() => normalizeHistory({ v: 1, runs: [] }), /cards/);
  });
});

describe('appendObservation', () => {
  it('first run: every listing gets a baseline entry, name hash, and the run is recorded', () => {
    const h = createEmptyHistory();
    const stats = appendObservation(h, [obs('a/1', 500, 2), obs('a/2', 120, null)], T0);
    assert.deepEqual(stats, {
      skipped: false, newCards: 2, priceChanges: 0, stockChanges: 0,
      pendingJumps: 0, confirmedJumps: 0, renamed: 0, pendingRenames: 0, massRename: false,
    });
    assert.deepEqual(h.cards, { 'a/1': [[T0, 500, 2]], 'a/2': [[T0, 120, null]] });
    assert.deepEqual(h.names, { 'a/1': nameHash('カードa/1'), 'a/2': nameHash('カードa/2') });
    assert.deepEqual(h.runs, [T0]);
    assert.equal(h.trackingSince, T0);
    assert.equal(h.lastGoodCount, 2);
    assert.deepEqual(h.recentCounts, [[T0, 2]]);
    assert.deepEqual(h.pendingRenames, {});
  });

  it('rejects a non-integer observedAt', () => {
    assert.throws(() => appendObservation(createEmptyHistory(), [], NaN), TypeError);
    assert.throws(() => appendObservation(createEmptyHistory(), [], 1.5), TypeError);
  });

  describe('rule 1: idempotent re-runs', () => {
    it('is a no-op for the same observedAt', () => {
      const h = seeded([obs('a/1', 500, 2)]);
      const before = clone(h);
      const stats = appendObservation(h, [obs('a/1', 900, 0), obs('a/9', 1, 1)], T0, { rawCount: 99 });
      assert.equal(stats.skipped, true);
      assert.equal(stats.newCards, 0);
      assert.deepEqual(h, before);
    });

    it('is a no-op for an older observedAt', () => {
      const h = seeded([obs('a/1', 500, 2)]);
      appendObservation(h, [obs('a/1', 600, 2)], T2);
      const before = clone(h);
      assert.equal(appendObservation(h, [obs('a/1', 700, 2)], T1).skipped, true);
      assert.deepEqual(h, before);
    });
  });

  describe('rule 2: non-finite price = not observed', () => {
    it('does not create a series for a new listing without a finite price', () => {
      const h = createEmptyHistory();
      const stats = appendObservation(h, [
        obs('a/1', null, 1), obs('a/2', NaN, 1), obs('a/3', Infinity, 1), obs('a/4', '500', 1), obs('a/5', undefined, 1),
        obs('a/6', 100, 1),
      ], T0);
      assert.deepEqual(Object.keys(h.cards), ['a/6']);
      assert.deepEqual(Object.keys(h.names), ['a/6']);
      assert.equal(stats.newCards, 1);
      // The raw catalog count (before filtering) is still the gate baseline.
      assert.equal(h.lastGoodCount, 6);
    });

    it('leaves an existing listing untouched (including its pending jump)', () => {
      const h = seeded([obs('a/1', 100, 2)]);
      appendObservation(h, [obs('a/1', 1000, 2)], T1); // pending
      const before = clone(h);
      appendObservation(h, [obs('a/1', null, 0)], T2);
      assert.deepEqual(h.cards, before.cards);
      assert.deepEqual(h.pending, before.pending);
      assert.deepEqual(h.runs, [T0, T1, T2]);
    });

    it('uses an explicit rawCount for lastGoodCount', () => {
      const h = createEmptyHistory();
      appendObservation(h, [obs('a/1', 100, 1)], T0, { rawCount: 28235 });
      assert.equal(h.lastGoodCount, 28235);
    });
  });

  it('rule 4: a listing first seen in a later run starts its own series', () => {
    const h = seeded([obs('a/1', 100, 1)]);
    const stats = appendObservation(h, [obs('a/1', 100, 1), obs('b/7', 2480, 4)], T1);
    assert.equal(stats.newCards, 1);
    assert.deepEqual(h.cards['b/7'], [[T1, 2480, 4]]);
    assert.equal(h.names['b/7'], nameHash('カードb/7'));
    assert.deepEqual(h.cards['a/1'], [[T0, 100, 1]]);
  });

  describe('rule 5: changes on existing listings', () => {
    it('appends on a price change', () => {
      const h = seeded([obs('a/1', 7980, 3)]);
      const stats = appendObservation(h, [obs('a/1', 9980, 3)], T1);
      assert.equal(stats.priceChanges, 1);
      assert.equal(stats.stockChanges, 0);
      assert.deepEqual(h.cards['a/1'], [[T0, 7980, 3], [T1, 9980, 3]]);
    });

    it('appends on a stock-only change', () => {
      const h = seeded([obs('a/1', 500, 3)]);
      const stats = appendObservation(h, [obs('a/1', 500, 0)], T1);
      assert.equal(stats.priceChanges, 0);
      assert.equal(stats.stockChanges, 1);
      assert.deepEqual(h.cards['a/1'], [[T0, 500, 3], [T1, 500, 0]]);
    });

    it('counts a simultaneous price + stock change once, as a price change', () => {
      const h = seeded([obs('a/1', 500, 3)]);
      const stats = appendObservation(h, [obs('a/1', 600, 1)], T1);
      assert.equal(stats.priceChanges, 1);
      assert.equal(stats.stockChanges, 0);
      assert.deepEqual(h.cards['a/1'], [[T0, 500, 3], [T1, 600, 1]]);
    });

    it('appends nothing when price and stock are unchanged', () => {
      const h = seeded([obs('a/1', 500, 3)]);
      appendObservation(h, [obs('a/1', 500, 3)], T1);
      assert.deepEqual(h.cards['a/1'], [[T0, 500, 3]]);
    });

    it('treats null stock (always available) as equal to null, and distinct from 0', () => {
      const h = seeded([obs('a/1', 30, null), obs('a/2', 30, null), obs('a/3', 30, 0)]);
      appendObservation(h, [obs('a/1', 30, null), obs('a/2', 30, 0), obs('a/3', 30, null)], T1);
      assert.deepEqual(h.cards['a/1'], [[T0, 30, null]]);
      assert.deepEqual(h.cards['a/2'], [[T0, 30, null], [T1, 30, 0]]);
      assert.deepEqual(h.cards['a/3'], [[T0, 30, 0], [T1, 30, null]]);
    });

    it('stores a missing stock as null', () => {
      const h = seeded([obs('a/1', 30, undefined)]);
      assert.deepEqual(h.cards['a/1'], [[T0, 30, null]]);
      appendObservation(h, [obs('a/1', 30, null)], T1);
      assert.deepEqual(h.cards['a/1'], [[T0, 30, null]]);
    });

    describe('implausible jumps (>= x5 either way)', () => {
      it('holds a x5 rise as pending and records nothing (stock change deferred too)', () => {
        const h = seeded([obs('a/1', 100, 5)]);
        const stats = appendObservation(h, [obs('a/1', 500, 2)], T1);
        assert.equal(stats.pendingJumps, 1);
        assert.equal(stats.priceChanges, 0);
        assert.equal(stats.stockChanges, 0);
        assert.deepEqual(h.cards['a/1'], [[T0, 100, 5]]);
        assert.deepEqual(h.pending['a/1'], { at: T1, price: 500, stock: 2 });
      });

      it('holds a /5 drop as pending', () => {
        const h = seeded([obs('a/1', 1000, 1)]);
        appendObservation(h, [obs('a/1', 200, 1)], T1);
        assert.deepEqual(h.cards['a/1'], [[T0, 1000, 1]]);
        assert.deepEqual(h.pending['a/1'], { at: T1, price: 200, stock: 1 });
      });

      it('records moves just inside the threshold immediately', () => {
        const h = seeded([obs('a/1', 100, 1), obs('a/2', 1000, 1)]);
        appendObservation(h, [obs('a/1', 499, 1), obs('a/2', 201, 1)], T1);
        assert.deepEqual(h.cards['a/1'], [[T0, 100, 1], [T1, 499, 1]]);
        assert.deepEqual(h.cards['a/2'], [[T0, 1000, 1], [T1, 201, 1]]);
        assert.deepEqual(h.pending, {});
      });

      it('never treats a move from a 0 price as a jump', () => {
        const h = seeded([obs('a/1', 0, 1)]);
        appendObservation(h, [obs('a/1', 5000, 1)], T1);
        assert.deepEqual(h.cards['a/1'], [[T0, 0, 1], [T1, 5000, 1]]);
        assert.deepEqual(h.pending, {});
      });

      it('confirms on repeat, stamped with the run that first saw it', () => {
        const h = seeded([obs('a/1', 100, 5)]);
        appendObservation(h, [obs('a/1', 1000, 2)], T1);
        const stats = appendObservation(h, [obs('a/1', 1000, 2)], T2);
        assert.equal(stats.confirmedJumps, 1);
        assert.equal(stats.priceChanges, 1);
        assert.equal(stats.stockChanges, 0);
        assert.deepEqual(h.cards['a/1'], [[T0, 100, 5], [T1, 1000, 2]]);
        assert.deepEqual(h.pending, {});
      });

      it('on confirmation, also records a stock change seen by the confirming run', () => {
        const h = seeded([obs('a/1', 100, 5)]);
        appendObservation(h, [obs('a/1', 1000, 2)], T1);
        const stats = appendObservation(h, [obs('a/1', 1000, 1)], T2);
        assert.equal(stats.confirmedJumps, 1);
        assert.equal(stats.stockChanges, 1);
        assert.deepEqual(h.cards['a/1'], [[T0, 100, 5], [T1, 1000, 2], [T2, 1000, 1]]);
      });

      it('confirms with null stocks compared by identity', () => {
        const h = seeded([obs('a/1', 100, null)]);
        appendObservation(h, [obs('a/1', 1000, null)], T1);
        appendObservation(h, [obs('a/1', 1000, null)], T2);
        assert.deepEqual(h.cards['a/1'], [[T0, 100, null], [T1, 1000, null]]);
      });

      it('discards a pending jump the next run does not repeat (back to the old price)', () => {
        const h = seeded([obs('a/1', 100, 5)]);
        appendObservation(h, [obs('a/1', 1000, 5)], T1);
        const stats = appendObservation(h, [obs('a/1', 100, 5)], T2);
        assert.equal(stats.confirmedJumps, 0);
        assert.deepEqual(h.pending, {});
        assert.deepEqual(h.cards['a/1'], [[T0, 100, 5]]);
      });

      it('discards a pending jump when the next run shows a different plausible price', () => {
        const h = seeded([obs('a/1', 100, 5)]);
        appendObservation(h, [obs('a/1', 1000, 5)], T1);
        appendObservation(h, [obs('a/1', 120, 4)], T2);
        assert.deepEqual(h.pending, {});
        assert.deepEqual(h.cards['a/1'], [[T0, 100, 5], [T2, 120, 4]]);
      });

      it('replaces a pending jump with a different implausible price, then confirms that one', () => {
        const h = seeded([obs('a/1', 100, 5)]);
        appendObservation(h, [obs('a/1', 1000, 5)], T1);
        const stats = appendObservation(h, [obs('a/1', 2000, 5)], T2);
        assert.equal(stats.pendingJumps, 1);
        assert.deepEqual(h.pending['a/1'], { at: T2, price: 2000, stock: 5 });
        appendObservation(h, [obs('a/1', 2000, 5)], T3);
        assert.deepEqual(h.cards['a/1'], [[T0, 100, 5], [T2, 2000, 5]]);
      });

      it('keeps a pending jump across a run where the listing was not seen', () => {
        const h = seeded([obs('a/1', 100, 5), obs('a/2', 1, 1)]);
        appendObservation(h, [obs('a/1', 1000, 5), obs('a/2', 1, 1)], T1);
        appendObservation(h, [obs('a/2', 1, 1)], T2);
        assert.deepEqual(h.pending['a/1'], { at: T1, price: 1000, stock: 5 });
        appendObservation(h, [obs('a/1', 1000, 5), obs('a/2', 1, 1)], T3);
        assert.deepEqual(h.cards['a/1'], [[T0, 100, 5], [T1, 1000, 5]]);
        assert.deepEqual(h.pending, {});
      });
    });
  });

  describe('rule 3: renames (confirmed on the next observation)', () => {
    it('holds a first rename as pending and treats the listing as not observed that run', () => {
      const h = seeded([obs('a/1', 100, 5, '旧カード'), obs('a/2', 50, 1, 'その他')]);
      appendObservation(h, [obs('a/1', 1000, 9, '旧カード'), obs('a/2', 50, 1, 'その他')], T1); // pending jump
      const stats = appendObservation(h, [obs('a/1', 980, 1, '新カード'), obs('a/2', 50, 1, 'その他')], T2);
      assert.equal(stats.pendingRenames, 1);
      assert.equal(stats.renamed, 0);
      assert.equal(stats.massRename, false);
      assert.deepEqual(h.pendingRenames, { 'a/1': nameHash('新カード') });
      assert.equal(h.names['a/1'], nameHash('旧カード'));
      assert.deepEqual(h.cards['a/1'], [[T0, 100, 5]]);
      assert.deepEqual(h.pending['a/1'], { at: T1, price: 1000, stock: 9 }); // untouched: not observed
      assert.deepEqual(h.retired, {});
    });

    it('retires the old series and starts a fresh one when the next observation keeps the new name', () => {
      const h = seeded([obs('a/1', 100, 5, '旧カード'), obs('a/2', 50, 1, 'その他')]);
      appendObservation(h, [obs('a/1', 100, 3, '旧カード'), obs('a/2', 50, 1, 'その他')], T1);
      appendObservation(h, [obs('a/1', 1000, 9, '旧カード'), obs('a/2', 50, 1, 'その他')], T2); // pending jump
      appendObservation(h, [obs('a/1', 980, 1, '新カード'), obs('a/2', 50, 1, 'その他')], T3); // pending rename
      const stats = appendObservation(h, [obs('a/1', 980, 2, '新カード'), obs('a/2', 50, 1, 'その他')], T4);
      assert.equal(stats.renamed, 1);
      assert.equal(stats.pendingRenames, 0);
      assert.equal(stats.newCards, 0);
      assert.deepEqual(h.retired, { [`a/1@${T4}`]: [[T0, 100, 5], [T1, 100, 3]] });
      assert.deepEqual(h.cards['a/1'], [[T4, 980, 2]]);
      assert.equal(h.names['a/1'], nameHash('新カード'));
      assert.deepEqual(h.pending, {});
      assert.deepEqual(h.pendingRenames, {});
      assert.deepEqual(h.cards['a/2'], [[T0, 50, 1]]);
    });

    it('clears a pending rename when the name goes back to the stored one', () => {
      const h = seeded([obs('a/1', 100, 5, '旧カード')]);
      appendObservation(h, [obs('a/1', 100, 5, '誤読')], T1);
      const stats = appendObservation(h, [obs('a/1', 120, 5, '旧カード')], T2);
      assert.equal(stats.renamed, 0);
      assert.deepEqual(h.pendingRenames, {});
      assert.deepEqual(h.retired, {});
      assert.deepEqual(h.cards['a/1'], [[T0, 100, 5], [T2, 120, 5]]);
    });

    it('replaces a pending rename with a third name, and confirms that one on repeat', () => {
      const h = seeded([obs('a/1', 100, 5, '旧カード')]);
      appendObservation(h, [obs('a/1', 100, 5, '名前B')], T1);
      const stats = appendObservation(h, [obs('a/1', 100, 5, '名前C')], T2);
      assert.equal(stats.pendingRenames, 1);
      assert.deepEqual(h.pendingRenames, { 'a/1': nameHash('名前C') });
      assert.deepEqual(h.cards['a/1'], [[T0, 100, 5]]);
      appendObservation(h, [obs('a/1', 300, 1, '名前C')], T3);
      assert.deepEqual(h.retired, { [`a/1@${T3}`]: [[T0, 100, 5]] });
      assert.deepEqual(h.cards['a/1'], [[T3, 300, 1]]);
    });

    it('keeps a pending rename across a run where the listing was not seen', () => {
      const h = seeded([obs('a/1', 100, 5, '旧カード'), obs('a/2', 1, 1)]);
      appendObservation(h, [obs('a/1', 100, 5, '新カード'), obs('a/2', 1, 1)], T1);
      appendObservation(h, [obs('a/2', 1, 1)], T2);
      assert.deepEqual(h.pendingRenames, { 'a/1': nameHash('新カード') });
      appendObservation(h, [obs('a/1', 100, 5, '新カード'), obs('a/2', 1, 1)], T3);
      assert.deepEqual(Object.keys(h.retired), [`a/1@${T3}`]);
    });

    it('does not treat spacing/width differences as a rename', () => {
      const h = seeded([obs('a/1', 100, 5, '騎士 A')]);
      const stats = appendObservation(h, [obs('a/1', 100, 5, '騎士Ａ')], T1);
      assert.equal(stats.renamed, 0);
      assert.equal(stats.pendingRenames, 0);
      assert.deepEqual(h.cards['a/1'], [[T0, 100, 5]]);
      assert.deepEqual(h.retired, {});
    });

    function listings(n, nameFor) {
      return Array.from({ length: n }, (_, i) => obs(`s/${i}`, 100, 1, nameFor(i)));
    }

    it('mass-rename guard: >5% and >20 renamed -> only rehash, no resets, no pending', () => {
      const h = seeded(listings(100, (i) => `名前${i}`));
      // A pending rename from an earlier run is superseded by the rehash.
      appendObservation(h, listings(100, (i) => (i === 0 ? '一時' : `名前${i}`)), T1);
      assert.deepEqual(Object.keys(h.pendingRenames), ['s/0']);
      // 25 of 100 change name; one of them also changes price.
      const next = listings(100, (i) => (i < 25 ? `新しい名前${i}` : `名前${i}`));
      next[0].price = 120;
      const stats = appendObservation(h, next, T2);
      assert.equal(stats.massRename, true);
      assert.equal(stats.renamed, 25);
      assert.equal(stats.pendingRenames, 0);
      assert.deepEqual(h.retired, {});
      assert.deepEqual(h.pendingRenames, {});
      assert.equal(h.names['s/0'], nameHash('新しい名前0'));
      assert.equal(h.names['s/30'], nameHash('名前30'));
      assert.deepEqual(h.cards['s/0'], [[T0, 100, 1], [T2, 120, 1]]);
      assert.deepEqual(h.cards['s/1'], [[T0, 100, 1]]);
    });

    it('mass-rename guard boundary: exactly 20 renamed is not a mass rename (needs > 20)', () => {
      const h = seeded(listings(100, (i) => `名前${i}`));
      const renamed = listings(100, (i) => (i < 20 ? `別${i}` : `名前${i}`));
      const stats = appendObservation(h, renamed, T1);
      assert.equal(stats.massRename, false);
      assert.equal(stats.pendingRenames, 20);
      assert.equal(Object.keys(h.retired).length, 0);
      assert.equal(appendObservation(h, renamed, T2).renamed, 20);
      assert.equal(Object.keys(h.retired).length, 20);
    });

    it('mass-rename guard boundary: 21 renamed but <= 5% of named listings is not a mass rename', () => {
      const h = seeded(listings(1000, (i) => `名前${i}`));
      const renamed = listings(1000, (i) => (i < 21 ? `別${i}` : `名前${i}`));
      assert.equal(appendObservation(h, renamed, T1).massRename, false);
      appendObservation(h, renamed, T2);
      assert.equal(Object.keys(h.retired).length, 21);
      assert.deepEqual(h.cards['s/0'], [[T2, 100, 1]]);
    });

    it('only counts observed listings that already have a stored name', () => {
      // 21 renamed out of 400 named listings (5.25%) -> mass rename even
      // though 1000 brand-new listings arrive in the same run.
      const h = seeded(listings(400, (i) => `名前${i}`));
      const next = listings(400, (i) => (i < 21 ? `別${i}` : `名前${i}`));
      for (let i = 0; i < 1000; i++) next.push(obs(`new/${i}`, 10, 1));
      const stats = appendObservation(h, next, T1);
      assert.equal(stats.massRename, true);
      assert.equal(stats.newCards, 1000);
    });
  });

  it('rule 6: listings in history but not observed are untouched', () => {
    const h = seeded([obs('a/1', 500, 3), obs('a/2', 800, 2)]);
    const before = clone(h.cards['a/2']);
    appendObservation(h, [obs('a/1', 500, 0)], T1);
    assert.deepEqual(h.cards['a/2'], before);
    assert.equal(h.names['a/2'], nameHash('カードa/2'));
  });

  it('rule 7: runs, lastGoodCount and trackingSince bookkeeping', () => {
    const h = seeded([obs('a/1', 500, 3)]);
    appendObservation(h, [obs('a/1', 500, 3), obs('a/2', 1, 1)], T1, { rawCount: 28235 });
    appendObservation(h, [obs('a/1', 500, 3)], T4);
    assert.deepEqual(h.runs, [T0, T1, T4]);
    assert.equal(h.trackingSince, T0);
    assert.equal(h.lastGoodCount, 1);
  });

  it('only records the first of duplicate ids within one run', () => {
    const h = seeded([obs('a/1', 500, 3)]);
    appendObservation(h, [obs('a/1', 600, 3), obs('a/1', 700, 3)], T1);
    assert.deepEqual(h.cards['a/1'], [[T0, 500, 3], [T1, 600, 3]]);
  });

  it('keeps every series strictly ascending over a realistic sequence', () => {
    const h = createEmptyHistory();
    const seq = [[100, 5], [100, 4], [600, 4], [600, 4], [120, 0], [120, null], [900, null], [900, 3]];
    seq.forEach(([p, s], i) => appendObservation(h, [obs('a/1', p, s)], T0 + i * 30));
    const minutes = h.cards['a/1'].map((e) => e[0]);
    for (let i = 1; i < minutes.length; i++) assert.ok(minutes[i] > minutes[i - 1]);
  });
});

describe('recentCounts and gateBaseline (run-gate baseline ratchet)', () => {
  it('records [minute, rawCount] per recorded run and not on a skipped one', () => {
    const h = createEmptyHistory();
    appendObservation(h, [obs('a/1', 1, 1)], T0, { rawCount: 28235 });
    appendObservation(h, [obs('a/1', 1, 1)], T1, { rawCount: 28200 });
    appendObservation(h, [obs('a/1', 1, 1)], T1, { rawCount: 5 }); // skipped
    assert.deepEqual(h.recentCounts, [[T0, 28235], [T1, 28200]]);
  });

  it('prunes entries older than 7 days before the latest run', () => {
    const h = createEmptyHistory();
    appendObservation(h, [obs('a/1', 1, 1)], T0, { rawCount: 30000 });
    appendObservation(h, [obs('a/1', 1, 1)], T0 + 3 * 1440, { rawCount: 29000 });
    appendObservation(h, [obs('a/1', 1, 1)], T0 + 7 * 1440, { rawCount: 28235 });
    assert.deepEqual(h.recentCounts, [[T0 + 3 * 1440, 29000], [T0 + 7 * 1440, 28235]]);
  });

  it('resetCountBaseline (an accepted shrink) restarts recentCounts from this run', () => {
    const h = createEmptyHistory();
    appendObservation(h, [obs('a/1', 1, 1)], T0, { rawCount: 28235 });
    appendObservation(h, [obs('a/1', 1, 1)], T1, { rawCount: 22235, resetCountBaseline: true });
    assert.deepEqual(h.recentCounts, [[T1, 22235]]);
    assert.equal(gateBaseline(h), 22235);
  });

  it('gateBaseline is the max of recentCounts, else lastGoodCount, else null', () => {
    const h = createEmptyHistory();
    assert.equal(gateBaseline(h), null);
    h.lastGoodCount = 28000;
    assert.equal(gateBaseline(h), 28000);
    h.recentCounts = [[T0, 28235], [T1, 27800], [T2, 27700]];
    assert.equal(gateBaseline(h), 28235);
    assert.equal(gateBaseline({ lastGoodCount: 5 }), 5); // pre-recentCounts history
  });

  it('normalizeHistory fills in recentCounts and pendingRenames', () => {
    const h = normalizeHistory({ v: 1, runs: [], cards: {} });
    assert.deepEqual(h.recentCounts, []);
    assert.deepEqual(h.pendingRenames, {});
  });
});

describe('checkObservationSanity (content gate)', () => {
  function tracked(n, stock = 3) {
    return seeded(Array.from({ length: n }, (_, i) => obs(`s/${i}`, 100, stock)));
  }
  function run(n, fn) {
    return Array.from({ length: n }, (_, i) => fn(i));
  }

  it('passes the first run (nothing tracked yet) and a normal run', () => {
    assert.equal(checkObservationSanity(createEmptyHistory(), run(10, (i) => obs(`s/${i}`, 1, 0)), 10).ok, true);
    const h = tracked(100);
    const r = checkObservationSanity(h, run(100, (i) => obs(`s/${i}`, i < 6 ? 120 : 100, 3)), 100);
    assert.deepEqual(r, { ok: true, overridden: false, message: null, priced: 100, comparable: 100, changed: 6 });
  });

  it('(i) fails when under 90% of the raw catalog has a finite price; exactly 90% passes', () => {
    const h = createEmptyHistory();
    const at90 = run(100, (i) => obs(`s/${i}`, i < 90 ? 100 : null, 1));
    assert.equal(checkObservationSanity(h, at90, 100).ok, true);
    const r = checkObservationSanity(h, run(100, (i) => obs(`s/${i}`, i < 89 ? 100 : NaN, 1)), 100);
    assert.equal(r.ok, false);
    assert.match(r.message, /89 of 100/);
    assert.match(r.message, /ALLOW_MASS_CHANGE=1/);
  });

  it('(ii) fails when more than 25% of tracked listings changed; exactly 25% passes', () => {
    const h = tracked(100);
    assert.equal(checkObservationSanity(h, run(100, (i) => obs(`s/${i}`, i < 25 ? 150 : 100, 3)), 100).ok, true);
    const r = checkObservationSanity(h, run(100, (i) => obs(`s/${i}`, 100, i < 26 ? 1 : 3)), 100);
    assert.equal(r.ok, false);
    assert.equal(r.changed, 26);
    assert.match(r.message, /26 of 100/);
  });

  it('catches a scrape where every stock parses as 0', () => {
    const h = tracked(100, null);
    const r = checkObservationSanity(h, run(100, (i) => obs(`s/${i}`, 100, 0)), 100);
    assert.equal(r.ok, false);
    assert.equal(r.changed, 100);
  });

  it('only compares listings that already have a series, and treats null === null', () => {
    const h = tracked(10, null);
    const obsList = run(10, (i) => obs(`s/${i}`, 100, null));
    for (let i = 0; i < 90; i++) obsList.push(obs(`new/${i}`, 5, 1));
    const r = checkObservationSanity(h, obsList, 100);
    assert.equal(r.ok, true);
    assert.equal(r.comparable, 10);
    assert.equal(r.changed, 0);
  });

  it('lets a flagged run through with allowMassChange, marked as overridden', () => {
    const h = tracked(100);
    const r = checkObservationSanity(h, run(100, (i) => obs(`s/${i}`, 100, 0)), 100, { allowMassChange: true });
    assert.equal(r.ok, true);
    assert.equal(r.overridden, true);
    assert.match(r.message, /ALLOW_MASS_CHANGE=1/);
  });

  it('allowMassChangeFromEnv is true only for ALLOW_MASS_CHANGE=1', () => {
    assert.equal(allowMassChangeFromEnv({ ALLOW_MASS_CHANGE: '1' }), true);
    assert.equal(allowMassChangeFromEnv({ ALLOW_MASS_CHANGE: 'yes' }), false);
    assert.equal(allowMassChangeFromEnv({}), false);
  });
});
