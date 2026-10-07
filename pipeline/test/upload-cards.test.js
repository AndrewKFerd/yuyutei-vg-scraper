'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  checkHistoryUpload,
  MIN_HISTORY_SHARE,
  readManifest,
  planShardUploads,
  planShardPrune,
  uploadShards,
  pruneShards,
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

describe('shard manifest (a cache of upload ETags)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-'));
  const file = path.join(tmp, 'm.json');
  const good = { v: 2, bucket: 'b', shards: { 'details/a.json': { hash: 'h1', etag: 'e1' } }, orphanedSince: { 'details/o.json': 123 } };

  it('reads a valid manifest for the same bucket', () => {
    fs.writeFileSync(file, JSON.stringify(good));
    assert.deepEqual(readManifest(file, 'b'), good);
  });

  it('treats a missing, corrupt, other-bucket or old-version manifest as empty', () => {
    const empty = { v: 2, bucket: 'b', shards: {}, orphanedSince: {} };
    assert.deepEqual(readManifest(path.join(tmp, 'nope.json'), 'b'), empty);
    fs.writeFileSync(file, '{"v":2,"bucket":');
    assert.deepEqual(readManifest(file, 'b'), empty);
    fs.writeFileSync(file, JSON.stringify(good));
    assert.deepEqual(readManifest(file, 'other'), { ...empty, bucket: 'other' });
    fs.writeFileSync(file, JSON.stringify({ ...good, v: 1 }));
    assert.deepEqual(readManifest(file, 'b'), empty);
  });
});

// A shard as listLocalShards returns it (content hash + MD5), without a file.
const shard = (name, content) => ({
  key: `details/${name}.json`,
  filePath: `/nowhere/${name}.json`,
  hash: crypto.createHash('sha256').update(content).digest('hex'),
  md5: crypto.createHash('md5').update(content).digest('hex'),
});
const remoteOf = (entries) => new Map(entries.map(([key, etag]) => [key, { etag, size: 1 }]));

describe('planShardUploads (the bucket decides, the manifest is a hint)', () => {
  const a = shard('a', 'one');
  const b = shard('b', 'two');
  const c = shard('c', 'three');
  const empty = { shards: {} };

  it('leaves shards whose remote ETag is the MD5 of the local content, uploads missing and differing ones', () => {
    const remote = remoteOf([[a.key, a.md5], [b.key, 'something-else']]);
    const plan = planShardUploads([a, b, c], remote, empty);
    assert.deepEqual(plan.toUpload.map((s) => s.key), [b.key, c.key]);
    assert.equal(plan.unchanged, 1);
  });

  it('heals a bucket emptied elsewhere even when the manifest says everything was uploaded', () => {
    const manifest = { shards: { [a.key]: { hash: a.hash, etag: 'e' }, [b.key]: { hash: b.hash, etag: 'e' } } };
    const plan = planShardUploads([a, b], remoteOf([]), manifest);
    assert.equal(plan.toUpload.length, 2);
  });

  it('trusts the recorded ETag only for the same content (a store whose ETags are not MD5s)', () => {
    const manifest = { shards: { [a.key]: { hash: a.hash, etag: 'opaque-1' } } };
    assert.equal(planShardUploads([a], remoteOf([[a.key, 'opaque-1']]), manifest).toUpload.length, 0);
    // the bucket's copy changed behind our back
    assert.equal(planShardUploads([a], remoteOf([[a.key, 'opaque-2']]), manifest).toUpload.length, 1);
    // our content changed since the manifest entry
    const changed = { ...a, hash: 'new-hash' };
    assert.equal(planShardUploads([changed], remoteOf([[a.key, 'opaque-1']]), manifest).toUpload.length, 1);
  });

  it('uploads everything when forced, and when a remote entry has no ETag', () => {
    assert.equal(planShardUploads([a, b], remoteOf([[a.key, a.md5], [b.key, b.md5]]), empty, { force: true }).toUpload.length, 2);
    assert.equal(planShardUploads([a], remoteOf([[a.key, null]]), empty).toUpload.length, 1);
  });
});

describe('uploadShards / pruneShards with a mocked bucket', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
  const manifestPath = path.join(dir, 'm.json');
  const shards = ['a', 'b', 'c', 'd'].map((n) => shard(n, n));
  const quiet = async (fn) => {
    const log = console.log;
    const warn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    try {
      return await fn();
    } finally {
      console.log = log;
      console.warn = warn;
    }
  };

  it('uploads what the listing says is missing or stale, and records their ETags', async () => {
    const puts = [];
    const res = await quiet(() => uploadShards({
      bucket: 'b', local: shards, manifestPath, force: false, concurrency: 1,
      listRemote: async () => remoteOf([[shards[0].key, shards[0].md5], [shards[1].key, 'stale']]),
      put: async (s) => { puts.push(s.key); return { bytes: 10, etag: `"etag-${s.key}"` }; },
    }));
    assert.deepEqual(puts, [shards[1].key, shards[2].key, shards[3].key]);
    assert.equal(res.uploaded, 3);
    const saved = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(saved.shards[shards[2].key].etag, `etag-${shards[2].key}`);
  });

  it('on a partial failure throws, keeps the successes in the manifest, and a rerun does only the rest', async () => {
    fs.rmSync(manifestPath, { force: true });
    let n = 0;
    await assert.rejects(quiet(() => uploadShards({
      bucket: 'b', local: shards, manifestPath, concurrency: 1,
      listRemote: async () => remoteOf([]),
      put: async (s) => {
        if (++n === 3) throw new Error('network down');
        return { bytes: 1, etag: `"e-${s.key}"` };
      },
    })), /network down/);
    const saved = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(Object.keys(saved.shards), [shards[0].key, shards[1].key]);
    // rerun: the bucket now has those two (opaque ETags the manifest knows)
    const puts = [];
    await quiet(() => uploadShards({
      bucket: 'b', local: shards, manifestPath, concurrency: 1,
      listRemote: async () => remoteOf([[shards[0].key, `e-${shards[0].key}`], [shards[1].key, `e-${shards[1].key}`]]),
      put: async (s) => { puts.push(s.key); return { bytes: 1, etag: '"x"' }; },
    }));
    assert.deepEqual(puts, [shards[2].key, shards[3].key]);
  });

  it('refuses to run with no local shards', async () => {
    await assert.rejects(uploadShards({ bucket: 'b', local: [], manifestPath, listRemote: async () => remoteOf([]) }), /No detail shards/);
  });

  // 10 live sets plus one orphan stays under the 20% guard.
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((n) => shard(n, n));
  const withOrphan = (...orphans) => remoteOf([...many.map((s) => [s.key, 'x']), ...orphans.map((k) => [k, 'x'])]);
  const HOUR = 3600 * 1000;
  const T0 = Date.UTC(2026, 9, 1);
  const freshManifest = () => ({ v: 2, bucket: 'b', shards: {}, orphanedSince: {} });

  it('first sees an orphan: records it, deletes nothing (also what a missing manifest means)', async () => {
    const removed = [];
    const manifest = freshManifest();
    const deleted = await quiet(() => pruneShards({
      local: many, remote: withOrphan('details/old1.json'), manifest, manifestPath, now: T0,
      remove: async (k) => { removed.push(k); },
    }));
    assert.equal(deleted, 0);
    assert.deepEqual(removed, []);
    assert.deepEqual(manifest.orphanedSince, { 'details/old1.json': T0 });
    // and it was persisted
    assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).orphanedSince, { 'details/old1.json': T0 });
  });

  it('keeps an orphan until it has been orphaned for 48 h, then deletes it', async () => {
    const removed = [];
    const manifest = { ...freshManifest(), orphanedSince: { 'details/old1.json': T0 } };
    const run = (now) => quiet(() => pruneShards({
      local: many, remote: withOrphan('details/old1.json'), manifest, manifestPath, now,
      remove: async (k) => { removed.push(k); },
    }));
    assert.equal(await run(T0 + 47 * HOUR), 0);
    assert.deepEqual(removed, []);
    assert.equal(await run(T0 + 48 * HOUR), 1);
    assert.deepEqual(removed, ['details/old1.json']);
    assert.deepEqual(manifest.orphanedSince, {}); // forgotten once deleted
  });

  it('clears the record when the set comes back, so a later orphaning starts a new 48 h clock', async () => {
    const removed = [];
    const manifest = { ...freshManifest(), orphanedSince: { 'details/old1.json': T0 } };
    const back = shard('old1', 'old1');
    // the set is back in the local build
    await quiet(() => pruneShards({
      local: [...many, back], remote: withOrphan('details/old1.json'), manifest, manifestPath, now: T0 + 60 * HOUR,
      remove: async (k) => { removed.push(k); },
    }));
    assert.deepEqual(removed, []);
    assert.deepEqual(manifest.orphanedSince, {});
    // dropped again later: the clock restarts
    await quiet(() => pruneShards({
      local: many, remote: withOrphan('details/old1.json'), manifest, manifestPath, now: T0 + 70 * HOUR,
      remove: async (k) => { removed.push(k); },
    }));
    assert.deepEqual(removed, []);
    assert.deepEqual(manifest.orphanedSince, { 'details/old1.json': T0 + 70 * HOUR });
  });

  it('tolerates a failed delete (retried next run) and still honours the 20% guard', async () => {
    const manifest = { ...freshManifest(), orphanedSince: { 'details/old1.json': T0 } };
    const none = await quiet(() => pruneShards({
      local: many, remote: withOrphan('details/old1.json'), manifest, manifestPath, now: T0 + 72 * HOUR,
      remove: async () => { throw new Error('denied'); },
    }));
    assert.equal(none, 0);
    assert.equal(manifest.orphanedSince['details/old1.json'], T0); // still due
    // over the cap: nothing is deleted however old, but the record is kept
    const kept = [];
    const old = { ...freshManifest(), orphanedSince: { 'details/o1.json': T0, 'details/o2.json': T0, 'details/o3.json': T0 } };
    await quiet(() => pruneShards({
      local: many.slice(0, 5), remote: withOrphan('details/o1.json', 'details/o2.json', 'details/o3.json'),
      manifest: old, manifestPath, now: T0 + 100 * HOUR, remove: async (k) => { kept.push(k); },
    }));
    assert.deepEqual(kept, []);
  });
});

describe('planShardPrune', () => {
  const local = ['a', 'b', 'c', 'd', 'e'].map((n) => shard(n, n));
  const keys = local.map((s) => s.key);
  const T0 = 1_000_000;

  it('ignores everything outside details/ and stamps new orphans with now', () => {
    const remote = remoteOf([...keys.map((k) => [k, 'x']), ['details/gone.json', 'x'], ['cards.json', 'x'], ['details/Bad_Name.json', 'x']]);
    const plan = planShardPrune(local, remote, {}, { now: T0 });
    assert.deepEqual(plan.orphanedSince, { 'details/gone.json': T0 });
    assert.deepEqual(plan.toDelete, []);
    assert.equal(plan.reason, null);
  });

  it('keeps an earlier first-seen time and drops keys that are no longer orphans', () => {
    const remote = remoteOf([...keys.map((k) => [k, 'x']), ['details/gone.json', 'x']]);
    const plan = planShardPrune(local, remote, { 'details/gone.json': 5, 'details/vanished.json': 5 }, { now: T0, minAgeMs: 10 });
    assert.deepEqual(plan.orphanedSince, { 'details/gone.json': 5 });
    assert.deepEqual(plan.toDelete, ['details/gone.json']);
  });

  it('refuses a mass deletion (a half-built local details/ must not empty the bucket)', () => {
    const remote = remoteOf([...keys, 'details/x1.json', 'details/x2.json', 'details/x3.json'].map((k) => [k, 'x']));
    const plan = planShardPrune(local.slice(0, 2), remote, { 'details/x1.json': 0 }, { now: T0 });
    assert.deepEqual(plan.toDelete, []);
    assert.match(plan.reason, /not deleting/);
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
