'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { checkCatalogSize, allowShrinkFromEnv, DEFAULT_THRESHOLD } = require('../catalog-gate');

const PASS = { ok: true, overridden: false, message: null };

describe('checkCatalogSize', () => {
  it('defaults to a 98% threshold', () => {
    assert.equal(DEFAULT_THRESHOLD, 0.98);
  });

  it('always fails an empty catalog, even with allowShrink or no baseline', () => {
    for (const [baseline, allowShrink] of [[28235, false], [28235, true], [null, false], [undefined, true]]) {
      const r = checkCatalogSize(0, baseline, { allowShrink });
      assert.equal(r.ok, false);
      assert.equal(r.overridden, false);
      assert.match(r.message, /0 cards/);
    }
  });

  it('fails a missing/non-numeric count', () => {
    assert.equal(checkCatalogSize(undefined, 100).ok, false);
    assert.equal(checkCatalogSize(NaN, null).ok, false);
  });

  it('fails a catalog below 98% of the baseline, explaining how to override', () => {
    const r = checkCatalogSize(22235, 28235);
    assert.equal(r.ok, false);
    assert.match(r.message, /22235/);
    assert.match(r.message, /28235/);
    assert.match(r.message, /98%/);
    assert.match(r.message, /ALLOW_CATALOG_SHRINK=1/);
  });

  it('fails a single missing search page (~576 cards)', () => {
    assert.equal(checkCatalogSize(28235 - 576, 28235).ok, false);
  });

  it('passes at exactly the threshold and fails one below it', () => {
    assert.equal(checkCatalogSize(98, 100).ok, true);
    assert.equal(checkCatalogSize(97, 100).ok, false);
    assert.equal(checkCatalogSize(27671, 28235).ok, true);
    assert.equal(checkCatalogSize(27670, 28235).ok, false);
  });

  it('lets a shrunken catalog through with allowShrink, flagged as overridden', () => {
    const r = checkCatalogSize(22235, 28235, { allowShrink: true });
    assert.equal(r.ok, true);
    assert.equal(r.overridden, true);
    assert.match(r.message, /ALLOW_CATALOG_SHRINK=1/);
  });

  it('does not flag allowShrink as used when the catalog did not shrink', () => {
    assert.deepEqual(checkCatalogSize(28235, 28235, { allowShrink: true }), PASS);
  });

  it('only applies the zero check without a baseline', () => {
    for (const baseline of [null, undefined, 0, NaN]) {
      assert.deepEqual(checkCatalogSize(5, baseline), PASS);
    }
  });

  it('passes growth and small shrinkage silently', () => {
    assert.deepEqual(checkCatalogSize(30000, 28235), PASS);
    assert.deepEqual(checkCatalogSize(28000, 28235), PASS);
  });

  it('honors a custom threshold', () => {
    assert.equal(checkCatalogSize(80, 100, { threshold: 0.8 }).ok, true);
    assert.equal(checkCatalogSize(79, 100, { threshold: 0.8 }).ok, false);
  });
});

describe('allowShrinkFromEnv', () => {
  it('is true only for ALLOW_CATALOG_SHRINK=1', () => {
    assert.equal(allowShrinkFromEnv({ ALLOW_CATALOG_SHRINK: '1' }), true);
    assert.equal(allowShrinkFromEnv({ ALLOW_CATALOG_SHRINK: 'true' }), false);
    assert.equal(allowShrinkFromEnv({ ALLOW_CATALOG_SHRINK: '0' }), false);
    assert.equal(allowShrinkFromEnv({}), false);
  });
});
