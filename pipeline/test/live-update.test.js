'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  stampOf, deltaKeyFor, structHash, stateOf, diffCatalogs, buildMeta, planLiveUpdate, MAX_CHAIN,
} = require('../build-delta');
const { buildBroadcastBody, notifyRealtime } = require('../notify-realtime');
const { publishLiveUpdate } = require('../upload-cards');
const { buildSlimCatalog } = require('../catalog-split');

const T1 = '2026-10-29T10:00:00.000Z';
const T2 = '2026-10-29T10:30:00.000Z';
const T3 = '2026-10-29T11:00:00.000Z';

function catalog(generatedAt, cards) {
  return {
    v: 1,
    generatedAt,
    count: cards.length,
    nations: [{ code: 'KS', label: 'Keter' }],
    sets: [{ slug: 'a', code: 'A', name: 'A' }],
    cards,
  };
}
const c = (id, price, stock, extra = {}) => ({ id, nameEn: id, price, stock, priceDisplay: `¥${price}`, ...extra });
const base = (gen = T1) => catalog(gen, [c('a/1', 100, 3), c('a/2', 200, 0), c('a/3', 300, null), c('a/4', 400, 1), c('a/5', 500, 1)]);

describe('stamps', () => {
  it('formats an ISO time as a compact UTC stamp', () => {
    assert.equal(stampOf(T1), '20261029T100000Z');
    assert.equal(deltaKeyFor(T1), 'deltas/20261029T100000Z.json');
    assert.equal(stampOf('nope'), null);
    assert.equal(deltaKeyFor('nope'), null);
  });
});

describe('structHash', () => {
  it('ignores price, stock, priceDisplay and chg7d', () => {
    const a = base();
    const b = base();
    b.cards[0] = { ...b.cards[0], price: 1, stock: 9, priceDisplay: '¥1', chg7d: { from: 5, at: 1 } };
    assert.equal(structHash(a), structHash(b));
  });

  it('changes with a name, a new card, the order or the set list', () => {
    const h = structHash(base());
    const renamed = base(); renamed.cards[0] = { ...renamed.cards[0], nameEn: 'X' };
    const added = base(); added.cards.push(c('a/6', 1, 1));
    const reordered = base(); reordered.cards.reverse();
    const sets = base(); sets.sets = [];
    for (const other of [renamed, added, reordered, sets]) assert.notEqual(structHash(other), h);
  });

  it('is put on the slim catalog by buildSlimCatalog', () => {
    const cards = [{ id: 'dbt08/1', setCode: 'D-BT08/001', setSlug: 'dbt08', price: 1, stock: 1, imageUrl: 'https://card.yuyu-tei.jp/vg/100_140/dbt08/1.jpg', detailUrl: 'https://yuyu-tei.jp/sell/vg/card/dbt08/1', priceDisplay: '¥1' }];
    const slim = buildSlimCatalog(cards, { generatedAt: T1 });
    assert.equal(slim.structHash, structHash(slim));
  });
});

describe('diffCatalogs', () => {
  const prev = stateOf(base(T1));

  it('lists price-only and stock-only changes', () => {
    const next = base(T2);
    next.cards[0] = { ...next.cards[0], price: 150 };
    next.cards[1] = { ...next.cards[1], stock: 2 };
    const { delta } = diffCatalogs(prev, next, { maxChangedShare: 0.5 });
    assert.deepEqual(delta, { v: 1, from: T1, to: T2, changes: [['a/1', 150, 3], ['a/2', 200, 2]] });
  });

  it('gives an empty delta when nothing changed', () => {
    assert.deepEqual(diffCatalogs(prev, base(T2)).delta.changes, []);
  });

  it('refuses without a baseline, for the same build, or after a structure change', () => {
    assert.equal(diffCatalogs(null, base(T2)).reason, 'no baseline');
    assert.equal(diffCatalogs(prev, base(T1)).reason, 'same build');
    const added = base(T2); added.cards.push(c('a/6', 1, 1));
    assert.equal(diffCatalogs(prev, added).reason, 'structure changed');
    const renamed = base(T2); renamed.cards[0] = { ...renamed.cards[0], nameEn: 'X' };
    assert.equal(diffCatalogs(prev, renamed).reason, 'structure changed');
  });

  it('skips the delta when too many listings changed', () => {
    const next = catalog(T2, base().cards.map((card) => ({ ...card, price: card.price + 1 })));
    const result = diffCatalogs(prev, next);
    assert.equal(result.delta, null);
    assert.match(result.reason, /5 of 5/);
  });
});

describe('buildMeta', () => {
  const cat = (gen) => base(gen);
  const d = (from, to) => ({ v: 1, from, to, changes: [['a/1', 1, 1]] });

  it('starts a chain, extends a continuing one and restarts a broken one', () => {
    const first = buildMeta(null, cat(T2), d(T1, T2));
    assert.deepEqual(first.deltas, [{ from: T1, to: T2, key: 'deltas/20261029T103000Z.json', n: 1 }]);
    const second = buildMeta(first, cat(T3), d(T2, T3));
    assert.deepEqual(second.deltas.map((x) => x.to), [T2, T3]);
    const broken = buildMeta(first, cat(T3), d('2026-10-29T10:45:00.000Z', T3));
    assert.deepEqual(broken.deltas.map((x) => x.to), [T3]);
  });

  it('has an empty chain without a delta and caps the chain length', () => {
    assert.deepEqual(buildMeta(null, cat(T1), null).deltas, []);
    let meta = null;
    let prev = new Date(T1).getTime();
    for (let i = 0; i < MAX_CHAIN + 5; i++) {
      const next = prev + 30 * 60000;
      meta = buildMeta(meta, cat(new Date(next).toISOString()), d(new Date(prev).toISOString(), new Date(next).toISOString()));
      prev = next;
    }
    assert.equal(meta.deltas.length, MAX_CHAIN);
  });
});

describe('planLiveUpdate', () => {
  it('reuses the baseline meta for a rerun of the same build', () => {
    const meta = { v: 1, generatedAt: T1, structHash: 'h', deltas: [] };
    const plan = planLiveUpdate({ ...stateOf(base(T1)), meta }, base(T1));
    assert.equal(plan.meta, meta);
    assert.equal(plan.delta, null);
  });
});

describe('publishLiveUpdate', () => {
  function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-'));
    const catalogPath = path.join(dir, 'catalog.json');
    const baselinePath = path.join(dir, 'catalog-published.json');
    const calls = [];
    const options = {
      catalogPath, baselinePath, deltasDir: path.join(dir, 'deltas'), metaPath: path.join(dir, 'meta.json'),
      put: async (key) => { calls.push(`put ${key}`); },
      listRemote: async () => new Map([['deltas/20200101T000000Z.json', {}], ['deltas/20261029T100000Z.json', {}]]),
      remove: async (key) => { calls.push(`remove ${key}`); },
      notify: async (generatedAt) => { calls.push(`notify ${generatedAt}`); return { sent: true }; },
      now: Date.parse('2026-10-29T12:00:00Z'),
    };
    return { dir, catalogPath, baselinePath, calls, options };
  }

  it('publishes no delta on the first run, then a delta with meta last and the baseline written', async () => {
    const { catalogPath, baselinePath, calls, options } = setup();
    fs.writeFileSync(catalogPath, JSON.stringify(base(T1)));
    await publishLiveUpdate(options);
    assert.deepEqual(calls.filter((x) => x.startsWith('put')), ['put meta.json']);
    assert.ok(fs.existsSync(baselinePath));

    calls.length = 0;
    const next = base(T2);
    next.cards[0] = { ...next.cards[0], price: 111 };
    fs.writeFileSync(catalogPath, JSON.stringify(next));
    const result = await publishLiveUpdate({ ...options, listRemote: async () => new Map() });
    assert.deepEqual(calls, ['put deltas/20261029T103000Z.json', 'put meta.json', `notify ${T2}`]);
    assert.deepEqual(result.delta.changes, [['a/1', 111, 3]]);
    assert.equal(JSON.parse(fs.readFileSync(baselinePath, 'utf8')).meta.deltas.length, 1);
  });

  it('does not save the baseline when an upload fails', async () => {
    const { catalogPath, baselinePath, options } = setup();
    fs.writeFileSync(catalogPath, JSON.stringify(base(T1)));
    await assert.rejects(publishLiveUpdate({ ...options, put: async () => { throw new Error('boom'); } }), /boom/);
    assert.equal(fs.existsSync(baselinePath), false);
  });

  it('deletes deltas older than 24 h that the chain no longer lists, and survives a failed broadcast', async () => {
    const { catalogPath, calls, options } = setup();
    fs.writeFileSync(catalogPath, JSON.stringify(base(T1)));
    await publishLiveUpdate({ ...options, notify: async () => ({ sent: false, reason: 'down' }) });
    assert.deepEqual(calls.filter((x) => x.startsWith('remove')), ['remove deltas/20200101T000000Z.json']);
  });
});

describe('notifyRealtime', () => {
  it('builds a public broadcast on the catalog channel', () => {
    assert.deepEqual(buildBroadcastBody(T1), {
      messages: [{ topic: 'catalog', event: 'updated', payload: { generatedAt: T1 }, private: false }],
    });
  });

  it('does nothing without credentials', async () => {
    let called = false;
    const r = await notifyRealtime(T1, { env: {}, fetchImpl: async () => { called = true; } });
    assert.equal(r.sent, false);
    assert.equal(called, false);
  });

  it('posts with the service key and reports failures instead of throwing', async () => {
    let seen;
    const ok = await notifyRealtime(T1, {
      env: { SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_SERVICE_KEY: 'k' },
      fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true }; },
    });
    assert.equal(ok.sent, true);
    assert.equal(seen.url, 'https://x.supabase.co/realtime/v1/api/broadcast');
    assert.equal(seen.init.headers.apikey, 'k');
    const bad = await notifyRealtime(T1, {
      env: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k' },
      fetchImpl: async () => { throw new Error('net'); },
    });
    assert.deepEqual(bad, { sent: false, reason: 'net' });
  });
});
