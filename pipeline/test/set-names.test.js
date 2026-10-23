'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { findSetName } = require('../set-names');

describe('findSetName', () => {
  it('names a listing by its exact Japanese name', () => {
    assert.equal(findSetName('DZ-TBP02/012', '無二の相棒 花村 陽介'), 'Peerless Partner, Yosuke Hanamura');
    assert.equal(findSetName('DZ-TBP02/T01', 'オルフェウス(男性型)'), 'Orpheus (Male)');
  });

  it('reuses the base name for a variant listing and translates its marker', () => {
    assert.equal(findSetName('DZ-TBP02/PS012', '無二の相棒 花村 陽介(箔押し)'), 'Peerless Partner, Yosuke Hanamura (Foil Stamping)');
    assert.equal(findSetName('DZ-TBP02/T+01', 'オルフェウス(男性型)(箔押し)'), 'Orpheus (Male) (Foil Stamping)');
  });

  it('only names cards of the set the entry belongs to', () => {
    assert.equal(findSetName('DZ-BT01/001', '月'), null);
    assert.equal(findSetName('DZ-TBP02/AR19', '月'), 'Moon');
  });

  it('does not match a longer name that merely starts with an entry', () => {
    assert.equal(findSetName('DZ-TBP02/999', 'イオの影'), null);
  });
});
