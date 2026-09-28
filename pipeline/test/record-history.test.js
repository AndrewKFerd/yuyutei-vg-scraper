'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadHistory,
  writeFileAtomic,
  readFileOrNull,
  backupDaily,
  localDate,
  FatalError,
} = require('../record-history');
const { hasS3Env, isMissingObject, isMissingHead, ENV_VARS } = require('../s3');

const STORED = { v: 1, trackingSince: 10, lastGoodCount: 3, runs: [10, 40], cards: { 'a/1': [[10, 100, 1]] } };

/** Injected IO that records which remote calls were made. */
function deps({ local = null, remoteConfigured = false, remote = null, remoteError = null, init = false } = {}) {
  const calls = { hasRemote: 0, fetchRemote: 0 };
  return {
    calls,
    readLocal: () => local,
    hasRemote: () => {
      calls.hasRemote++;
      return remoteConfigured;
    },
    fetchRemote: async () => {
      calls.fetchRemote++;
      if (remoteError) throw remoteError;
      return remote;
    },
    init,
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yuyutei-history-test-'));
}

describe('loadHistory', () => {
  it('uses the local file when present, without touching the bucket', async () => {
    const d = deps({ local: JSON.stringify(STORED), remoteConfigured: true, remote: Buffer.from('{}') });
    const { history, source } = await loadHistory(d);
    assert.equal(source, 'local');
    assert.deepEqual(history.runs, [10, 40]);
    assert.deepEqual(history.pending, {}); // normalized
    assert.deepEqual(history.recentCounts, []);
    assert.deepEqual(d.calls, { hasRemote: 0, fetchRemote: 0 });
  });

  it('refuses a corrupt local file (even with HISTORY_INIT=1), pointing at every way to recover', async () => {
    const d = deps({ local: '{"v":1,"runs":[1', remoteConfigured: true, remote: Buffer.from(JSON.stringify(STORED)), init: true });
    await assert.rejects(loadHistory(d), (err) => err instanceof FatalError &&
      /unreadable/.test(err.message) &&
      /price-history\.prev\.json/.test(err.message) &&
      /history-backups/.test(err.message) &&
      /delete data\/price-history\.json/.test(err.message) &&
      /--env-file=\.env/.test(err.message));
    assert.equal(d.calls.fetchRemote, 0);
  });

  it('refuses an empty or wrong-version local file', async () => {
    await assert.rejects(loadHistory(deps({ local: '' })), FatalError);
    await assert.rejects(loadHistory(deps({ local: JSON.stringify({ ...STORED, v: 2 }) })), /version/);
  });

  it('restores from the bucket when the local file is missing', async () => {
    const d = deps({ remoteConfigured: true, remote: Buffer.from(JSON.stringify(STORED)) });
    const { history, source, raw } = await loadHistory(d);
    assert.equal(source, 'remote');
    assert.equal(raw, JSON.stringify(STORED));
    assert.deepEqual(history.cards, STORED.cards);
    assert.equal(d.calls.fetchRemote, 1);
  });

  it('prefers the bucket copy over HISTORY_INIT=1 (never starts fresh over a remote history)', async () => {
    const { source } = await loadHistory(deps({ remoteConfigured: true, remote: JSON.stringify(STORED), init: true }));
    assert.equal(source, 'remote');
  });

  it('refuses a corrupt bucket copy', async () => {
    const d = deps({ remoteConfigured: true, remote: Buffer.from('not json'), init: true });
    await assert.rejects(loadHistory(d), (err) => err instanceof FatalError && /bucket copy/.test(err.message));
  });

  it('exits with backfill instructions when the bucket was checked and has no copy either', async () => {
    await assert.rejects(
      loadHistory(deps({ remoteConfigured: true, remote: null })),
      (err) => err instanceof FatalError && /in the bucket/.test(err.message) &&
        /backfill-history\.js/.test(err.message) && /HISTORY_INIT=1/.test(err.message)
    );
  });

  it('starts empty on HISTORY_INIT=1 only after the bucket reported no such object', async () => {
    const d = deps({ remoteConfigured: true, remote: null, init: true });
    const { history, source } = await loadHistory(d);
    assert.equal(source, 'init');
    assert.equal(d.calls.fetchRemote, 1);
    assert.deepEqual(history.runs, []);
    assert.equal(history.trackingSince, null);
  });

  it('refuses on a network/auth error, even with HISTORY_INIT=1', async () => {
    const err = Object.assign(new Error('Access Denied'), { name: 'AccessDenied' });
    const d = deps({ remoteConfigured: true, remoteError: err, init: true });
    await assert.rejects(loadHistory(d), (e) => e instanceof FatalError && /Access Denied/.test(e.message));
  });

  it('without S3 env: only tells the user to rerun with --env-file=.env, and never calls the bucket', async () => {
    const d = deps({ remoteConfigured: false });
    await assert.rejects(loadHistory(d), (err) => err instanceof FatalError &&
      /--env-file=\.env/.test(err.message) &&
      !/backfill/.test(err.message) &&
      !/HISTORY_INIT/.test(err.message));
    assert.equal(d.calls.fetchRemote, 0);
  });

  it('without S3 env: refuses even with HISTORY_INIT=1 (the bucket was never checked)', async () => {
    const d = deps({ remoteConfigured: false, init: true });
    await assert.rejects(loadHistory(d), (err) => err instanceof FatalError && /--env-file=\.env/.test(err.message));
    assert.equal(d.calls.fetchRemote, 0);
  });
});

describe('writeFileAtomic / readFileOrNull', () => {
  it('writes via a fsynced .tmp file and leaves no temp file behind', () => {
    const dir = tmpDir();
    try {
      const target = path.join(dir, 'price-history.json');
      assert.equal(readFileOrNull(target), null);
      writeFileAtomic(target, 'one');
      writeFileAtomic(target, 'two');
      assert.equal(readFileOrNull(target), 'two');
      assert.deepEqual(fs.readdirSync(dir), ['price-history.json']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('backupDaily', () => {
  it('copies the history once per date and keeps only the newest 14', () => {
    const dir = tmpDir();
    try {
      const src = path.join(dir, 'price-history.json');
      const backups = path.join(dir, 'history-backups');
      fs.writeFileSync(src, 'v1');
      assert.equal(backupDaily(src, backups, '2026-09-28'), path.join(backups, 'price-history-2026-09-28.json'));
      // A later run the same day doesn't overwrite the day's first copy.
      fs.writeFileSync(src, 'v2');
      assert.equal(backupDaily(src, backups, '2026-09-28'), null);
      assert.equal(fs.readFileSync(path.join(backups, 'price-history-2026-09-28.json'), 'utf8'), 'v1');

      fs.writeFileSync(path.join(backups, 'notes.txt'), 'not a backup');
      for (let d = 1; d <= 20; d++) backupDaily(src, backups, `2026-10-${String(d).padStart(2, '0')}`);
      const kept = fs.readdirSync(backups).filter((f) => f.startsWith('price-history-')).sort();
      assert.equal(kept.length, 14);
      assert.equal(kept[0], 'price-history-2026-10-07.json');
      assert.equal(kept[13], 'price-history-2026-10-20.json');
      assert.ok(fs.existsSync(path.join(backups, 'notes.txt'))); // unrelated files untouched
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('localDate formats a minute as YYYY-MM-DD in local time', () => {
    const minute = Math.floor(new Date(2026, 8, 28, 23, 59).getTime() / 60000);
    assert.equal(localDate(minute), '2026-09-28');
    assert.equal(localDate(minute + 1), '2026-09-29');
  });
});

describe('s3 helpers', () => {
  it('hasS3Env requires every SUPABASE_S3_* var', () => {
    const full = Object.fromEntries(ENV_VARS.map((n) => [n, 'x']));
    assert.equal(hasS3Env(full), true);
    assert.equal(hasS3Env({ ...full, SUPABASE_S3_BUCKET: '' }), false);
    assert.equal(hasS3Env({}), false);
  });

  it('isMissingObject (GET): only NoSuchKey means "no such object"', () => {
    assert.equal(isMissingObject({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }), true);
    assert.equal(isMissingObject({ name: 'NotFound', $metadata: { httpStatusCode: 404 } }), false);
    assert.equal(isMissingObject({ name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } }), false);
    assert.equal(isMissingObject({ name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }), false);
    assert.equal(isMissingObject(null), false);
  });

  it('isMissingHead (HEAD, no body): NotFound or HTTP 404 means "no remote copy"', () => {
    assert.equal(isMissingHead({ name: 'NotFound', $metadata: { httpStatusCode: 404 } }), true);
    assert.equal(isMissingHead({ name: 'UnknownError', $metadata: { httpStatusCode: 404 } }), true);
    assert.equal(isMissingHead({ name: 'Forbidden', $metadata: { httpStatusCode: 403 } }), false);
    assert.equal(isMissingHead({ name: 'TimeoutError' }), false);
  });
});
