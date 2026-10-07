'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { NATIONS, KNOWN_CODES, nationOf } = require('../nation');
const { buildSlimCatalog } = require('../catalog-split');

describe('nationOf', () => {
  it('reads D-era nations in English and Japanese', () => {
    assert.equal(nationOf('Keter Sanctuary'), 'KS');
    assert.equal(nationOf('ケテルサンクチュアリ'), 'KS');
    assert.equal(nationOf('Lyrical Monasterio'), 'LM');
    assert.equal(nationOf('ストイケイア'), 'ST');
  });

  it('maps classic clans to their nation, in either language', () => {
    assert.equal(nationOf('Royal Paladin'), 'US');
    assert.equal(nationOf('ロイヤルパラディン'), 'US');
    assert.equal(nationOf('Genesis'), 'US');
    assert.equal(nationOf('ギアクロニクル'), 'DZ');
    assert.equal(nationOf('バミューダ△'), 'MG');
    assert.equal(nationOf('Link Joker'), 'SG');
    assert.equal(nationOf('ネオネクタール'), 'ZO');
  });

  it('puts classic Dragon Empire clans in the same nation as D-era Dragon Empire', () => {
    assert.equal(nationOf('かげろう'), 'DE');
    assert.equal(nationOf('Dragon Empire'), 'DE');
  });

  it('buckets title/collab sets, including BanG Dream! song cards', () => {
    assert.equal(nationOf('Touken Ranbu'), 'TC');
    assert.equal(nationOf('バディファイト'), 'TC');
    assert.equal(nationOf('楽曲/Roselia'), 'TC');
    assert.equal(nationOf('Poppin’Party'), 'TC');
  });

  it('returns every nation of a multi-nation card', () => {
    assert.deepEqual(nationOf('ドラゴンエンパイア/ストイケイア'), ['DE', 'ST']);
  });

  it('returns null for no nation (Cray Elemental, noise, missing)', () => {
    for (const clan of ['Cray Elemental', 'クレイエレメンタル', '-', 'Grade 0', 'その他', '', null, undefined]) {
      assert.equal(nationOf(clan), null, String(clan));
    }
  });

  it('only ever returns codes the NATIONS list labels', () => {
    assert.equal(KNOWN_CODES.size, NATIONS.length);
    for (const clan of ['Royal Paladin', 'Dark States', 'Touken Ranbu', 'ドラゴンエンパイア/ストイケイア']) {
      for (const code of [nationOf(clan)].flat()) assert.ok(KNOWN_CODES.has(code), code);
    }
  });
});

describe('slim catalog nations', () => {
  it('ships the nation list once, at the top level', () => {
    const catalog = buildSlimCatalog([], { generatedAt: 'x' });
    assert.deepEqual(catalog.nations, NATIONS);
  });
});
