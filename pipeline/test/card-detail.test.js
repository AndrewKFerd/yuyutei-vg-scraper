'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { classifyEntry } = require('../scrape-card-detail');

describe('classifyEntry (what --missing refetches)', () => {
  it('treats a card with no entry as never fetched', () => {
    assert.equal(classifyEntry(undefined), 'absent');
    assert.equal(classifyEntry(null), 'absent');
  });

  it('treats an entry with effect text as done', () => {
    assert.equal(classifyEntry({ effect: '【自】：...', kind: 'ノーマルユニット', power: 9000 }), 'done');
  });

  it('treats gift markers and other non-cards as legitimately textless', () => {
    assert.equal(classifyEntry({ effect: null, kind: 'ギフトマーカー' }), 'none');
    assert.equal(classifyEntry({ effect: null, kind: 'その他', grade: 3 }), 'none');
  });

  it('treats a unit that has stats (a power) but no text as a vanilla unit', () => {
    assert.equal(classifyEntry({ effect: null, kind: 'ノーマルユニット', grade: 1, power: 7000 }), 'none');
    assert.equal(classifyEntry({ effect: null, kind: 'トリガーユニット', grade: 0, power: 5000 }), 'none');
  });

  it('retries pages that were still blank when fetched', () => {
    assert.equal(classifyEntry({ effect: null }), 'blank');
    // a half-filled page: grade and nation, but no power or text
    assert.equal(classifyEntry({ effect: null, kind: 'ノーマルユニット', grade: 3, nation: 'バディファイト' }), 'blank');
    // orders always have text once the page is filled in
    assert.equal(classifyEntry({ effect: null, kind: 'ノーマルオーダー', grade: 1 }), 'blank');
  });
});
