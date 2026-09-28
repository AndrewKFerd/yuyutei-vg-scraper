'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { repairPreSentinelStock, checkRemoteBeforeBackfill, contentSignature, isRebuild } = require('../backfill-history');

describe('checkRemoteBeforeBackfill', () => {
  const remote = (size) => async () => size;
  const failing = async () => {
    throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { name: 'Error' });
  };

  it('proceeds when the bucket was checked and has no history', async () => {
    assert.deepEqual(await checkRemoteBeforeBackfill({ hasRemote: () => true, remoteSize: remote(null) }), { ok: true, message: null });
  });

  it('refuses when the bucket already has a history, unless --force-remote', async () => {
    const r = await checkRemoteBeforeBackfill({ hasRemote: () => true, remoteSize: remote(1755721) });
    assert.equal(r.ok, false);
    assert.match(r.message, /1755721-byte/);
    assert.match(r.message, /--force-remote/);
    const forced = await checkRemoteBeforeBackfill({ hasRemote: () => true, remoteSize: remote(1755721), forceRemote: true });
    assert.equal(forced.ok, true);
    assert.match(forced.message, /--force-remote/);
  });

  it('refuses when the bucket check fails, even with --force-remote or --no-remote-check', async () => {
    for (const flags of [{}, { forceRemote: true }, { noRemoteCheck: true }]) {
      const r = await checkRemoteBeforeBackfill({ hasRemote: () => true, remoteSize: failing, ...flags });
      assert.equal(r.ok, false);
      assert.match(r.message, /ENOTFOUND/);
    }
  });

  it('refuses without S3 env unless --no-remote-check (--force-remote does not help)', async () => {
    let called = false;
    const spy = async () => {
      called = true;
      return null;
    };
    const r = await checkRemoteBeforeBackfill({ hasRemote: () => false, remoteSize: spy, forceRemote: true });
    assert.equal(r.ok, false);
    assert.match(r.message, /--env-file=\.env/);
    assert.match(r.message, /--no-remote-check/);
    const skipped = await checkRemoteBeforeBackfill({ hasRemote: () => false, remoteSize: spy, noRemoteCheck: true });
    assert.equal(skipped.ok, true);
    assert.equal(called, false);
  });
});

describe('contentSignature', () => {
  const o = (id, price, stock) => ({ id, nameJp: 'x', setCode: 'X-1', price, stock });

  it('is independent of listing order and of names', () => {
    const a = [o('a/1', 100, 1), o('a/2', 200, null)];
    const b = [{ ...o('a/2', 200, null), nameJp: 'y' }, o('a/1', 100, 1)];
    assert.equal(contentSignature(a), contentSignature(b));
  });

  it('changes with any price, stock (incl. 0 vs null) or listing difference', () => {
    const base = contentSignature([o('a/1', 100, 1), o('a/2', 200, 0)]);
    assert.notEqual(contentSignature([o('a/1', 101, 1), o('a/2', 200, 0)]), base);
    assert.notEqual(contentSignature([o('a/1', 100, 1), o('a/2', 200, null)]), base);
    assert.notEqual(contentSignature([o('a/1', 100, 1)]), base);
  });
});

describe('isRebuild', () => {
  const prev = { signature: 'abc' };

  it('skips a feature-commit snapshot whose content matches the previous accepted one', () => {
    assert.equal(isRebuild({ signature: 'abc', subject: 'Add JP skill text for DZSS19, DZBT16, DZBT15' }, prev), true);
  });

  it('keeps a scheduled-refresh snapshot even when nothing changed (a real no-change scrape)', () => {
    assert.equal(isRebuild({ signature: 'abc', subject: 'Update card catalog (2026-09-17T22:12 local)' }, prev), false);
  });

  it('keeps any snapshot whose content differs, and the first one', () => {
    assert.equal(isRebuild({ signature: 'def', subject: 'Fix unlimited-stock cards' }, prev), false);
    assert.equal(isRebuild({ signature: 'abc', subject: 'x' }, null), false);
  });
});

describe('repairPreSentinelStock', () => {
  const snap = (observedAt, stocks) => ({
    observedAt,
    observations: Object.entries(stocks).map(([id, stock]) => ({ id, nameJp: id, setCode: 'X-1', price: 10, stock })),
  });

  it('reads pre-fix 0 as null for listings the first bulk-null snapshot shows as null', () => {
    // 'c' was genuinely 0 before and is still 0; 'b' later has a count; 'a' becomes the marker.
    const filler = Object.fromEntries(Array.from({ length: 96 }, (_, i) => [`f${i}`, 3]));
    const snaps = [
      snap(1, { a: 0, b: 0, c: 0, ...filler }),
      snap(2, { a: 0, b: 2, c: 0, ...filler }),
      snap(3, { a: null, b: 2, c: 0, d: null, ...filler }), // 2 nulls of 100 >= 1%
      snap(4, { a: 0, b: 2, c: 0, ...filler }),
    ];
    const r = repairPreSentinelStock(snaps);
    assert.deepEqual(r, { fixedIdx: 2, repaired: 2 });
    const stockOf = (s, id) => s.observations.find((o) => o.id === id).stock;
    assert.equal(stockOf(snaps[0], 'a'), null);
    assert.equal(stockOf(snaps[1], 'a'), null);
    assert.equal(stockOf(snaps[0], 'b'), 0);
    assert.equal(stockOf(snaps[0], 'c'), 0);
    assert.equal(stockOf(snaps[3], 'a'), 0); // only snapshots before the fix are touched
  });

  it('does nothing when the first snapshot already has the marker, or none does', () => {
    assert.deepEqual(repairPreSentinelStock([snap(1, { a: null }), snap(2, { a: 0 })]), { fixedIdx: 0, repaired: 0 });
    assert.deepEqual(repairPreSentinelStock([snap(1, { a: 0 }), snap(2, { a: 0 })]), { fixedIdx: -1, repaired: 0 });
  });
});
