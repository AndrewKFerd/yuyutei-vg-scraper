'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { seriesOfCode, familyOfCode, parseSeries, ALL_SERIES } = require('../fandom-series');
const { extractCodes, pageToCard, parseArgs, mergeScrapes } = require('../scrape-fandom');
const { createMatcher } = require('../match-fandom');

describe('seriesOfCode / familyOfCode', () => {
  it('reads the series off the prefix', () => {
    assert.equal(seriesOfCode('D-BT01/DSR02'), 'D');
    assert.equal(seriesOfCode('dz-bt17/001'), 'DZ');
    assert.equal(seriesOfCode('V-EB05/SSP01'), 'V');
    assert.equal(seriesOfCode('G-BT01/001'), 'G');
    assert.equal(seriesOfCode('BT01/S02'), 'OLD');
    assert.equal(seriesOfCode('PR/0089'), 'OLD');
    assert.equal(seriesOfCode('VG-X01/001'), null);
    assert.equal(seriesOfCode('not a code'), null);
  });

  it('puts D and DZ in one family, every other series on its own', () => {
    assert.equal(familyOfCode('D-BT01/001'), 'D');
    assert.equal(familyOfCode('DZ-BT01/001'), 'D');
    assert.equal(familyOfCode('V-BT01/001'), 'V');
    assert.equal(familyOfCode('BT01/001'), 'OLD');
  });
});

describe('parseSeries', () => {
  it('parses a comma list case-insensitively, in canonical order', () => {
    assert.deepEqual(parseSeries('g, v,dz'), ['DZ', 'V', 'G']);
    assert.deepEqual(parseSeries(ALL_SERIES.join(',')), ALL_SERIES);
  });
  it('rejects an unknown name', () => {
    assert.throws(() => parseSeries('D,X'), /Unknown --series "X"/);
    assert.throws(() => parseSeries(''), /Unknown --series/);
  });
});

describe('extractCodes', () => {
  const fields = {
    set1: 'TD01/005<br>TD01/005KR<br>TD01/005EN<br>TD01/005TH',
    set2: 'BT01/002 (RRR) - BT01/S02 (SP)<br>BT01/002EN (RRR)',
    set7: 'G-LD03/009<br>G-LD03/009EN',
    set8: 'DZ-SS16/PGS01 (PGS) 2026<br>V-EB05/SSP01',
    flavor: 'ignored BT99/001',
  };

  it('keeps Japanese printings of every series by default, dropping EN/TH/KR ones', () => {
    assert.deepEqual(extractCodes(fields).sort(), [
      'BT01/002', 'BT01/S02', 'DZ-SS16/PGS01', 'G-LD03/009', 'TD01/005', 'V-EB05/SSP01',
    ]);
  });

  it('does not read a bare code out of the middle of a prefixed one', () => {
    assert.deepEqual(extractCodes({ set1: 'DZ-BT17/001' }), ['DZ-BT17/001']);
  });

  it('filters to the requested series', () => {
    assert.deepEqual(extractCodes(fields, ['G']), ['G-LD03/009']);
    assert.deepEqual(extractCodes(fields, ['D', 'DZ']), ['DZ-SS16/PGS01']);
  });
});

describe('pageToCard', () => {
  const page = (content, title = 'Some Card') => ({ title, revisions: [{ slots: { main: { content } } }] });
  const cardTable = '{{CardTable\n|kanji = テスト\n|grade = 1\n|set1 = G-BT01/001<br>BT01/002\n}}';

  it('keeps a page that lists a printing in a selected series, with only those codes', () => {
    const card = pageToCard(page(cardTable), ['G']);
    assert.deepEqual(card.codes, ['G-BT01/001']);
    assert.equal(card.kanji, 'テスト');
  });

  it('drops a page with no printing in the selected series', () => {
    assert.equal(pageToCard(page(cardTable), ['D', 'DZ', 'V']), null);
  });

  it('keeps every page of a D-era-only template when a D-era series is selected, even with no codes', () => {
    const dTable = '{{DTable\n|kanji = テスト\n}}';
    assert.ok(pageToCard(page(dTable), ['D'], ['D', 'DZ']));
    assert.equal(pageToCard(page(dTable), ['G'], ['D', 'DZ']), null);
  });
});

describe('parseArgs', () => {
  it('defaults to every series, unlimited, writing the real file', () => {
    const o = parseArgs([]);
    assert.deepEqual(o.series, ALL_SERIES);
    assert.equal(o.limit, Infinity);
  });

  it('refuses --limit without --out, so a sample cannot replace data/fandom-raw.json', () => {
    assert.throws(() => parseArgs(['--limit', '3']), /--out/);
    assert.equal(parseArgs(['--limit', '3', '--out', 'x.json']).limit, 3);
  });

  it('rejects bad arguments', () => {
    assert.throws(() => parseArgs(['--series']), /needs a value/);
    assert.throws(() => parseArgs(['--limit', '0', '--out', 'x']), /positive integer/);
    assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
  });
});

describe('createMatcher', () => {
  const raw = {
    cards: [
      { title: 'Dragon', nameEn: 'Dragon', kanji: 'ドラゴン', codes: ['D-BT01/001', 'DZ-BT02/005'] },
      { title: 'Knight', nameEn: 'Knight', kanji: '騎士', codes: ['G-BT01/001', 'BT01/002'] },
      { title: 'Hero (V)', nameEn: 'Hero', kanji: '英雄', codes: ['V-BT01/001'] },
      { title: 'Hero (G)', nameEn: 'Hero G', kanji: '英雄', codes: ['G-BT05/001'] },
      { title: 'Twin A', nameEn: 'Twin A', kanji: '双子', codes: ['V-BT03/001'] },
      { title: 'Twin B', nameEn: 'Twin B', kanji: '双子', codes: ['V-BT04/001'] },
    ],
  };
  const find = createMatcher(raw);

  it('matches by exact card code in any series', () => {
    assert.equal(find('G-BT01/001', 'なんでも').title, 'Knight');
    assert.equal(find('bt01/002', 'なんでも').title, 'Knight');
    assert.equal(find('DZ-BT02/005', 'x').title, 'Dragon');
  });

  it('falls back to the Japanese name within the same series family only', () => {
    assert.equal(find('V-BT09/050', '騎士'), null); // "騎士" is only a G-/older card
    assert.equal(find('G-BT09/050', '騎士').title, 'Knight');
    assert.equal(find('D-BT09/050', 'ドラゴン(箔押し)').title, 'Dragon'); // variant marker stripped
    assert.equal(find('DZ-BT09/050', 'ドラゴン').title, 'Dragon'); // D and DZ are one family
  });

  it('disambiguates a shared name by set, and gives up when that is not unique', () => {
    assert.equal(find('V-BT03/099', '双子').title, 'Twin A');
    assert.equal(find('V-BT04/099', '双子').title, 'Twin B');
    assert.equal(find('V-BT09/099', '双子'), null);
    assert.equal(find('V-BT09/099', '英雄').title, 'Hero (V)'); // the G page is a different family
  });

  it('returns null for unsupported prefixes, missing codes and an empty scrape', () => {
    assert.equal(find('VG-X01/001', 'ドラゴン'), null);
    assert.equal(find('', 'ドラゴン'), null);
    assert.equal(createMatcher(null)('D-BT01/001', 'ドラゴン'), null);
  });
});

describe('codeless pages (DZ-BT11/EX30, EX31 regression)', () => {
  // These two {{DTable}} pages list no printing codes; they match by name only.
  const pages = [
    { title: 'Magic for Finding Lost Accessories', nameEn: 'Magic for Finding Lost Accessories', kanji: '失せ物探しの魔法', codes: [] },
    { title: 'Magic to Create a Field of Flowers', nameEn: 'Magic to Create a Field of Flowers', kanji: '花畑を作る魔法', codes: [] },
  ];

  it('an old fandom-raw.json (no series field) treats codeless pages as D-era', () => {
    const find = createMatcher({ cards: pages });
    assert.equal(find('DZ-BT11/EX30', '失せ物探しの魔法').title, 'Magic for Finding Lost Accessories');
    assert.equal(find('DZ-BT11/EX31', '花畑を作る魔法(箔押し)').title, 'Magic to Create a Field of Flowers');
    assert.equal(find('V-BT11/EX30', '失せ物探しの魔法'), null); // not an era the page belongs to
  });

  it('a newer file uses the recorded family, and does not guess for pages without one', () => {
    const tagged = createMatcher({ series: ['D', 'DZ', 'V'], cards: pages.map((p) => ({ ...p, family: 'D' })) });
    assert.equal(tagged('D-BT11/EX30', '失せ物探しの魔法').title, 'Magic for Finding Lost Accessories');
    const untagged = createMatcher({ series: ['D', 'DZ', 'V'], cards: pages });
    assert.equal(untagged('D-BT11/EX30', '失せ物探しの魔法'), null);
  });

  it('pageToCard records the template family on a {{DTable}} page', () => {
    const page = { title: 'X', revisions: [{ slots: { main: { content: '{{DTable\n|kanji = テスト\n}}' } } }] };
    assert.equal(pageToCard(page, ['D'], ['D', 'DZ']).family, 'D');
    assert.equal('family' in pageToCard({ ...page, revisions: [{ slots: { main: { content: '{{CardTable\n|kanji = テ\n|set1 = G-BT01/001\n}}' } } }] }, ['G']), false);
  });
});

describe('series of unusual prefixes', () => {
  it('V-era promos (VPR/) are V, not OLD', () => {
    assert.equal(seriesOfCode('VPR/0001'), 'V');
    assert.equal(familyOfCode('vpr/0042'), 'V');
  });

  it('other unprefixed spin-off sets are OLD; hyphenated gift codes belong to no series', () => {
    for (const code of ['VZ/001', 'MB/066', 'DG01/005', 'CG01/001', 'KAD1/002', 'MBT01/L01', 'FC01/S02', 'HS08/001']) {
      assert.equal(seriesOfCode(code), 'OLD', code);
    }
    assert.equal(seriesOfCode('VG-10th/0001'), null);
    assert.equal(seriesOfCode('001'), null);
  });

  it('generic PR/ promos match by exact code only, never by name', () => {
    const find = createMatcher({
      series: ['OLD'],
      cards: [{ title: 'Shield', nameEn: 'Guardian Shield', kanji: 'ガーディアンシールド', codes: ['PR/0860', 'BT01/001'] }],
    });
    assert.equal(find('PR/0860', 'x').title, 'Shield');
    assert.equal(find('PR/0999', 'ガーディアンシールド'), null);
    assert.equal(find('BT02/001', 'ガーディアンシールド').title, 'Shield'); // a real product set still may
  });
});

describe('mergeScrapes (a partial --series run must not drop the other series)', () => {
  const page = (title, codes, extra = {}) => ({ title, nameEn: title, kanji: title, codes, ...extra });
  const existing = {
    series: ['D', 'DZ', 'V', 'G'],
    cards: [
      page('Dee', ['D-BT01/001', 'DZ-BT01/001']),
      page('Codeless', [], { family: 'D' }),
      page('Both', ['D-BT01/002', 'V-BT01/002']),
      page('Vee', ['V-BT01/001']),
      page('Gone', ['V-BT01/099']),
      page('Gee', ['G-BT01/001']),
    ],
  };

  it('replaces only the scraped series and keeps everything else', () => {
    const scraped = [page('Vee', ['V-BT01/001', 'V-BT01/S01']), page('Both', ['V-BT01/002']), page('NewV', ['V-BT02/001'])];
    const out = mergeScrapes(existing, scraped, ['V']);
    const by = Object.fromEntries(out.cards.map((c) => [c.title, c]));
    assert.deepEqual(Object.keys(by).sort(), ['Both', 'Codeless', 'Dee', 'Gee', 'NewV', 'Vee']);
    assert.deepEqual(by.Dee.codes, ['D-BT01/001', 'DZ-BT01/001']);
    assert.deepEqual(by.Gee.codes, ['G-BT01/001']);
    assert.ok(by.Codeless); // D-era codeless page survives a V-only run
    assert.deepEqual(by.Vee.codes, ['V-BT01/001', 'V-BT01/S01']);
    // a card printed in D and V keeps its D code when only V is rescraped
    assert.deepEqual(by.Both.codes.sort(), ['D-BT01/002', 'V-BT01/002']);
    assert.equal(by.Gone, undefined); // V page that left the wiki
    assert.deepEqual(out.series, ['D', 'DZ', 'V', 'G']);
  });

  it('treats an old file with no series field as a D/DZ scrape, and widens the recorded series', () => {
    const old = { cards: [page('Dee', ['D-BT01/001']), page('Codeless', [])] };
    const out = mergeScrapes(old, [page('Gee', ['G-BT01/001'])], ['G']);
    assert.deepEqual(out.cards.map((c) => c.title).sort(), ['Codeless', 'Dee', 'Gee']);
    assert.deepEqual(out.series, ['D', 'DZ', 'G']);
  });

  it('drops a codeless page of a family that was rescraped but did not come back', () => {
    const out = mergeScrapes(existing, [], ['D', 'DZ']);
    assert.equal(out.cards.some((c) => c.title === 'Codeless'), false);
    assert.ok(out.cards.some((c) => c.title === 'Gee'));
  });
});
