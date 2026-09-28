'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { checkHistoryUpload, MIN_HISTORY_SHARE } = require('../upload-cards');

const PASS = { ok: true, message: null };

describe('checkHistoryUpload', () => {
  it('uses a 90% floor', () => {
    assert.equal(MIN_HISTORY_SHARE, 0.9);
  });

  it('allows the upload when the bucket has no copy yet', () => {
    assert.deepEqual(checkHistoryUpload(1000, null), PASS);
    assert.deepEqual(checkHistoryUpload(1000, undefined), PASS);
  });

  it('allows a local file that grew, stayed the same, or is at least 90% of the remote', () => {
    assert.deepEqual(checkHistoryUpload(1755721, 1729258), PASS);
    assert.deepEqual(checkHistoryUpload(1000, 1000), PASS);
    assert.deepEqual(checkHistoryUpload(900, 1000), PASS);
  });

  it('refuses a local file under 90% of the remote copy, explaining the recovery and override', () => {
    const r = checkHistoryUpload(899, 1000);
    assert.equal(r.ok, false);
    assert.match(r.message, /899 bytes/);
    assert.match(r.message, /1000 bytes/);
    assert.match(r.message, /refusing to upload anything/);
    assert.match(r.message, /FORCE_HISTORY_UPLOAD=1/);
    // e.g. a freshly backfilled history about to replace months of runs
    assert.equal(checkHistoryUpload(1729258, 9_000_000).ok, false);
  });

  it('lets FORCE_HISTORY_UPLOAD=1 override, with a warning', () => {
    const r = checkHistoryUpload(10, 1000, { force: true });
    assert.equal(r.ok, true);
    assert.match(r.message, /FORCE_HISTORY_UPLOAD=1/);
  });

  it('has nothing to decide when there is no local file', () => {
    assert.deepEqual(checkHistoryUpload(null, 1000), PASS);
  });
});
