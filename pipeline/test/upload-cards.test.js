'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  checkHistoryUpload,
  MIN_HISTORY_SHARE,
  readManifest,
  planShardUploads,
  listLocalShards,
  runPool,
  OBJECTS,
} = require('../upload-cards');

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

describe('upload order', () => {
  it('uploads the history files first, and catalog.json before the transitional cards.json', () => {
    const keys = OBJECTS.map((o) => o.key);
    assert.deepEqual(keys, ['price-history.json', 'history-public.json', 'movers.json', 'catalog.json', 'cards.json']);
    assert.equal(OBJECTS.find((o) => o.key === 'catalog.json').required, true);
  });
});

describe('shard manifest', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-'));
  const file = path.join(tmp, 'm.json');
  const good = { v: 1, bucket: 'b', shards: { 'details/a.json': 'h1' } };

  it('reads a valid manifest for the same bucket', () => {
    fs.writeFileSync(file, JSON.stringify(good));
    assert.deepEqual(readManifest(file, 'b'), good);
  });

  it('treats a missing, corrupt, other-bucket or other-version manifest as empty (upload everything)', () => {
    const empty = { v: 1, bucket: 'b', shards: {} };
    assert.deepEqual(readManifest(path.join(tmp, 'nope.json'), 'b'), empty);
    fs.writeFileSync(file, '{"v":1,"bucket":');
    assert.deepEqual(readManifest(file, 'b'), empty);
    fs.writeFileSync(file, JSON.stringify(good));
    assert.deepEqual(readManifest(file, 'other'), { ...empty, bucket: 'other' });
    fs.writeFileSync(file, JSON.stringify({ ...good, v: 2 }));
    assert.deepEqual(readManifest(file, 'b'), empty);
  });
});

describe('planShardUploads', () => {
  const local = [
    { key: 'details/a.json', hash: 'h1' },
    { key: 'details/b.json', hash: 'h2' },
    { key: 'details/c.json', hash: 'h3' },
  ];
  const manifest = { shards: { 'details/a.json': 'h1', 'details/b.json': 'old' } };

  it('uploads only new or changed shards', () => {
    const plan = planShardUploads(local, manifest);
    assert.deepEqual(plan.toUpload.map((s) => s.key), ['details/b.json', 'details/c.json']);
    assert.equal(plan.unchanged, 1);
  });

  it('uploads everything with an empty manifest or when forced', () => {
    assert.equal(planShardUploads(local, { shards: {} }).toUpload.length, 3);
    assert.equal(planShardUploads(local, manifest, { force: true }).toUpload.length, 3);
  });
});

describe('listLocalShards', () => {
  it('hashes each shard file by content and returns [] for a missing directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shards-'));
    fs.writeFileSync(path.join(dir, 'b.json'), 'two');
    fs.writeFileSync(path.join(dir, 'a.json'), 'one');
    fs.writeFileSync(path.join(dir, 'a.json.tmp'), 'ignored');
    const shards = listLocalShards(dir);
    assert.deepEqual(shards.map((s) => s.key), ['details/a.json', 'details/b.json']);
    assert.notEqual(shards[0].hash, shards[1].hash);
    assert.equal(shards[0].hash, listLocalShards(dir)[0].hash);
    assert.deepEqual(listLocalShards(path.join(dir, 'missing')), []);
  });
});

describe('runPool', () => {
  it('runs every item within the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const done = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      done.push(n);
    });
    assert.equal(done.length, 7);
    assert.ok(peak <= 3);
  });

  it('rethrows a failure, stops starting new items, and keeps the successes already done', async () => {
    const done = [];
    await assert.rejects(
      runPool([1, 2, 3, 4, 5, 6], 1, async (n) => {
        if (n === 3) throw new Error('boom');
        done.push(n);
      }),
      /boom/
    );
    assert.deepEqual(done, [1, 2]);
  });
});
