'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const {
  slimCard,
  buildSlimCatalog,
  buildSetList,
  buildDetailShards,
  writeDetailShards,
  detailOf,
} = require('../catalog-split');

function card(overrides = {}) {
  const id = overrides.id || 'dbt08/10158';
  return {
    id,
    setCode: 'D-BT08/SNR01',
    setSlug: id.split('/')[0],
    rarity: 'SNR',
    nameJp: 'ミネルヴァ',
    nameEn: 'Minerva',
    translationSource: 'official',
    kind: 'Normal Unit',
    clan: 'Keter Sanctuary',
    grade: 3,
    power: 13000,
    shield: null,
    skillTextEn: 'text',
    flavorEn: null,
    wikiTitle: null,
    skillTextJp: 'テキスト',
    flavorJp: null,
    price: 59800,
    priceDisplay: '¥59,800',
    stock: 0,
    imageUrl: `https://card.yuyu-tei.jp/vg/100_140/${id}.jpg`,
    detailUrl: `https://yuyu-tei.jp/sell/vg/card/${id}`,
    ...overrides,
  };
}

describe('slimCard', () => {
  it('drops heavy fields and derivable URLs/price text, keeping what the grid and Movers use', () => {
    assert.deepEqual(slimCard(card()), {
      id: 'dbt08/10158',
      setCode: 'D-BT08/SNR01',
      setSlug: 'dbt08',
      rarity: 'SNR',
      nameJp: 'ミネルヴァ',
      nameEn: 'Minerva',
      translationSource: 'official',
      price: 59800,
      stock: 0,
      nation: 'KS',
    });
  });

  it('omits nation for a card with no recognizable one', () => {
    assert.equal('nation' in slimCard(card({ clan: '-' })), false);
    assert.equal('nation' in slimCard(card({ clan: null })), false);
  });

  it('keeps chg7d, and keeps a field explicitly when it differs from the derivation (including null)', () => {
    const slim = slimCard(card({
      chg7d: { from: 100, at: 5 },
      imageUrl: 'https://card.yuyu-tei.jp/noimage_100_140.jpg',
      detailUrl: null,
      priceDisplay: '¥59800',
    }));
    assert.deepEqual(slim.chg7d, { from: 100, at: 5 });
    assert.equal(slim.imageUrl, 'https://card.yuyu-tei.jp/noimage_100_140.jpg');
    assert.equal(slim.detailUrl, null);
    assert.equal(slim.priceDisplay, '¥59800');
  });
});

describe('frontend hydrateCards is the inverse of slimCard', () => {
  it('restores every card exactly (minus the heavy fields)', async () => {
    const { hydrateCards } = await import(pathToFileURL(path.join(__dirname, '../../frontend/src/catalogFormat.js')).href);
    const originals = [
      card(),
      card({ id: 'dzbt15/10392', imageUrl: 'https://card.yuyu-tei.jp/noimage_100_140.jpg' }),
      card({ id: 'x-1/1', imageUrl: null, detailUrl: null }),
      card({ id: 'gift/9', price: 1234567, priceDisplay: '¥1,234,567', chg7d: { from: 1, at: 2 } }),
    ];
    const restored = hydrateCards(JSON.parse(JSON.stringify(originals.map(slimCard))));
    restored.forEach((r, i) => {
      for (const field of ['id', 'price', 'priceDisplay', 'imageUrl', 'detailUrl', 'stock', 'nameEn']) {
        assert.deepEqual(r[field], originals[i][field], `${originals[i].id}.${field}`);
      }
    });
  });
});

describe('buildSlimCatalog', () => {
  it('wraps the slim cards with a version, timestamp and count', () => {
    const cat = buildSlimCatalog([card(), card({ id: 'dbt08/2' })], { generatedAt: 'T' });
    assert.equal(cat.v, 1);
    assert.equal(cat.generatedAt, 'T');
    assert.equal(cat.count, 2);
    assert.equal(cat.cards.length, 2);
  });
});

describe('buildSetList', () => {
  const cards = [
    card({ id: 'dbt08/1' }),
    card({ id: 'dbt08/2', setCode: 'D-BT08/002' }),
    card({ id: 'dbt08/3', setCode: 'D-PR/100' }), // a reprint from elsewhere
    card({ id: 'promo-100/4', setCode: 'PR/0004' }),
    card({ id: 'zzz/5', setCode: 'X-TD01/005' }),
  ];

  it('follows the shop order, takes the majority code prefix and strips the [TAG] from names', () => {
    const list = buildSetList(cards, [
      { slug: 'promo-100', label: 'PR/001〜PR/100' },
      { slug: 'gone', label: '[GONE] not in the catalog' },
      { slug: 'dbt08', label: '[DBT08] 女神再臨' },
    ]);
    assert.deepEqual(list, [
      { slug: 'promo-100', code: null, name: 'PR/001–PR/100' },
      { slug: 'dbt08', code: 'D-BT08', name: '女神再臨' },
      { slug: 'zzz', code: 'X-TD01', name: null },
    ]);
  });

  it('falls back to codes only, by slug, without a scraped list', () => {
    assert.deepEqual(buildSetList(cards, undefined).map((s) => [s.slug, s.code, s.name]), [
      ['dbt08', 'D-BT08', null],
      ['promo-100', 'PR', null],
      ['zzz', 'X-TD01', null],
    ]);
  });

  it('is part of the slim catalog', () => {
    const cat = buildSlimCatalog(cards, { generatedAt: 'T', sets: [{ slug: 'dbt08', label: '[DBT08] 女神再臨' }] });
    assert.equal(cat.sets[0].code, 'D-BT08');
  });
});

describe('detail shards', () => {
  it('detailOf keeps only non-null heavy fields, null when there are none', () => {
    assert.deepEqual(detailOf(card()), {
      kind: 'Normal Unit', clan: 'Keter Sanctuary', grade: 3, power: 13000,
      skillTextEn: 'text', skillTextJp: 'テキスト',
    });
    assert.equal(detailOf(card({
      kind: null, clan: null, grade: null, power: null, shield: null,
      skillTextEn: null, skillTextJp: null, flavorEn: null, flavorJp: null, wikiTitle: null,
    })), null);
  });

  it('groups by set, includes empty sets, and is deterministic regardless of card order', () => {
    const empty = { kind: null, clan: null, grade: null, power: null, skillTextEn: null, skillTextJp: null };
    const a = card({ id: 'dbt08/2' });
    const b = card({ id: 'dbt08/1' });
    const c = card({ id: 'gift/1', ...empty });
    const one = buildDetailShards([a, b, c]);
    const two = buildDetailShards([c, b, a]);
    assert.deepEqual([...one.keys()], ['dbt08', 'gift']);
    assert.equal(JSON.stringify(one.get('dbt08')), JSON.stringify(two.get('dbt08')));
    assert.deepEqual(Object.keys(one.get('dbt08').cards), ['dbt08/1', 'dbt08/2']);
    assert.deepEqual(one.get('gift').cards, {});
  });

  it('skips (with a warning) a set whose slug the API would not serve, instead of failing the build', () => {
    const warnings = [];
    const warn = console.warn;
    console.warn = (m) => warnings.push(m);
    let shards;
    try {
      shards = buildDetailShards([
        card(),
        card({ id: 'Bad_Slug/1', setSlug: 'Bad_Slug' }),
        card({ id: 'x/1', setSlug: undefined }),
        card({ id: 'a.b/1', setSlug: 'a.b' }),
      ]);
    } finally {
      console.warn = warn;
    }
    assert.deepEqual([...shards.keys()], ['dbt08']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Bad_Slug/);
    assert.match(warnings[0], /a\.b/);
  });

  it('writeDetailShards rewrites only changed shards and removes shards of vanished sets', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shards-'));
    try {
      const first = buildDetailShards([card(), card({ id: 'gift/1' })]);
      assert.deepEqual(writeDetailShards(dir, first), { written: 2, unchanged: 0, removed: 0 });
      assert.deepEqual(writeDetailShards(dir, first), { written: 0, unchanged: 2, removed: 0 });
      const second = buildDetailShards([card({ skillTextEn: 'changed' })]);
      assert.deepEqual(writeDetailShards(dir, second), { written: 1, unchanged: 0, removed: 1 });
      assert.deepEqual(fs.readdirSync(dir), ['dbt08.json']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
