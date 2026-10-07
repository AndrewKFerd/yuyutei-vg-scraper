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
    });
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

  it('refuses a set slug that the API would not serve', () => {
    assert.throws(() => buildDetailShards([card({ id: 'Bad_Slug/1', setSlug: 'Bad_Slug' })]), /can't be served/);
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
