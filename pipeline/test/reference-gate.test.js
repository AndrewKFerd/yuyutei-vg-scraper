'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_THRESHOLD,
  allowOfficialShrinkFromEnv,
  checkReferenceScrape,
  checkOfficialRetention,
} = require('../reference-gate');

const PASS = { ok: true, overridden: false, message: null };

describe('checkReferenceScrape', () => {
  it('defaults to a 98% threshold', () => {
    assert.equal(DEFAULT_THRESHOLD, 0.98);
  });

  it('passes a complete scrape that did not shrink', () => {
    assert.deepEqual(checkReferenceScrape({ count: 7005, previousCount: 7005 }), PASS);
    assert.deepEqual(checkReferenceScrape({ count: 7200, previousCount: 7005, problems: [] }), PASS);
  });

  it('keeps the previous file for the partial scrapes refresh.log recorded', () => {
    // Sep 19 (site down), Sep 24 23:08, Sep 30 20:04, Oct 1 20:02.
    for (const count of [0, 435, 321, 4943]) {
      const r = checkReferenceScrape({ count, previousCount: 7005 });
      assert.equal(r.ok, false, `count ${count}`);
      assert.equal(r.overridden, false);
      assert.match(r.message, /keeping the previous cf-vanguard-raw\.json \(7005 cards\)/);
      assert.match(r.message, /ALLOW_OFFICIAL_SHRINK=1/);
    }
  });

  it('keeps the previous file when any set is incomplete, even at full size', () => {
    const r = checkReferenceScrape({ count: 7005, previousCount: 7005, problems: ['DZ-BT15: 200 of 224 cards'] });
    assert.equal(r.ok, false);
    assert.match(r.message, /DZ-BT15: 200 of 224 cards/);
  });

  it('lists every reason', () => {
    const r = checkReferenceScrape({
      count: 100,
      previousCount: 7005,
      problems: ['DZ-BT15 failed to load, so family DZ-BT was cut short'],
    });
    assert.match(r.message, /family DZ-BT was cut short/);
    assert.match(r.message, /100 cards is below 98% of the previous scrape's 7005 \(minimum 6865\)/);
  });

  it('passes at exactly the threshold and fails one below it', () => {
    assert.equal(checkReferenceScrape({ count: 98, previousCount: 100 }).ok, true);
    assert.equal(checkReferenceScrape({ count: 97, previousCount: 100 }).ok, false);
  });

  it('fails a non-numeric count against a previous file', () => {
    assert.equal(checkReferenceScrape({ count: NaN, previousCount: 100 }).ok, false);
  });

  it('writes an incomplete scrape when there is no previous file to keep, with a warning', () => {
    for (const previousCount of [null, undefined, 0, NaN]) {
      const r = checkReferenceScrape({ count: 50, previousCount, problems: ['D-BT03: 10 of 200 cards'] });
      assert.equal(r.ok, true);
      assert.equal(r.overridden, false);
      assert.match(r.message, /no previous scrape to keep/);
    }
    assert.deepEqual(checkReferenceScrape({ count: 50, previousCount: null }), PASS);
  });

  it('lets ALLOW_OFFICIAL_SHRINK through, flagged as overridden', () => {
    const r = checkReferenceScrape({ count: 435, previousCount: 7005, problems: ['x'] }, { allowShrink: true });
    assert.equal(r.ok, true);
    assert.equal(r.overridden, true);
    assert.match(r.message, /ALLOW_OFFICIAL_SHRINK=1/);
  });

  it('does not flag the override as used when nothing was wrong', () => {
    assert.deepEqual(checkReferenceScrape({ count: 7005, previousCount: 7005 }, { allowShrink: true }), PASS);
  });
});

describe('checkOfficialRetention', () => {
  it('passes when (nearly) every previously official listing is still official', () => {
    assert.deepEqual(checkOfficialRetention(6303, 6303), PASS);
    assert.deepEqual(checkOfficialRetention(6177, 6303), PASS); // 98.0%
  });

  it('fails the official-name losses that reached the live site', () => {
    for (const kept of [14, 0, 4757]) {
      const r = checkOfficialRetention(kept, 6303);
      assert.equal(r.ok, false, `kept ${kept}`);
      assert.match(r.message, new RegExp(`Only ${kept} of the 6303 listings`));
      assert.match(r.message, /scrape-cf-vanguard\.js/);
      assert.match(r.message, /ALLOW_OFFICIAL_SHRINK=1/);
    }
  });

  it('passes at exactly the threshold and fails one below it', () => {
    assert.equal(checkOfficialRetention(98, 100).ok, true);
    assert.equal(checkOfficialRetention(97, 100).ok, false);
  });

  it('has nothing to check without a previous build', () => {
    for (const previous of [0, null, undefined, NaN]) {
      assert.deepEqual(checkOfficialRetention(0, previous), PASS);
    }
  });

  it('lets ALLOW_OFFICIAL_SHRINK through, flagged as overridden', () => {
    const r = checkOfficialRetention(14, 6303, { allowShrink: true });
    assert.equal(r.ok, true);
    assert.equal(r.overridden, true);
    assert.match(r.message, /building anyway/);
  });
});

describe('allowOfficialShrinkFromEnv', () => {
  it('is true only for ALLOW_OFFICIAL_SHRINK=1', () => {
    assert.equal(allowOfficialShrinkFromEnv({ ALLOW_OFFICIAL_SHRINK: '1' }), true);
    assert.equal(allowOfficialShrinkFromEnv({ ALLOW_OFFICIAL_SHRINK: 'true' }), false);
    assert.equal(allowOfficialShrinkFromEnv({}), false);
  });
});
