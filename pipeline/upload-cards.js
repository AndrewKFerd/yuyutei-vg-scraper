'use strict';

/**
 * Uploads the built pipeline/data files to a private Supabase Storage
 * bucket (via its S3-compatible endpoint). The frontend never talks to
 * Supabase directly -- it fetches through the Vercel Functions in
 * frontend/api/ (cards.js, history.js, movers.js), which proxy an
 * allowlist of these same objects with their own credentials. Run this
 * after record-history.js and build-data.js.
 *
 * Objects, in order:
 *  - price-history.json   the canonical price history -- private, never
 *                         served; uploaded as the backup record-history.js
 *                         restores from if the local copy is lost
 *  - history-public.json  served via /api/history
 *  - movers.json          served via /api/movers
 *  - details/<slug>.json  one shard per set, served via /api/details/<slug>.
 *                         Only shards whose content changed since their last
 *                         successful upload are sent (see the manifest below)
 *  - catalog.json         the slim grid catalog, served via /api/catalog
 *                         (required). Uploaded only after every shard it
 *                         relies on, so it never points at a missing one
 *  - cards.json           the full catalog, no longer served (required).
 *                         The split frontend is live and the /api/cards
 *                         route is gone, so this entry can be dropped
 *                         (README: "Catalog split")
 * The history files go first so the backup lands even if a later upload
 * fails. A missing history/movers file is skipped with a warning (e.g.
 * before the history has been seeded); any upload error exits 1.
 *
 * The ~300 shards are rarely all different, so each run lists details/ in the
 * bucket (one paginated ListObjectsV2) and uploads only the shards that are
 * missing there or whose remote ETag differs from the local content's MD5
 * (the ETag of a single-part PUT, which is how putFile uploads). That makes
 * it self-healing when the bucket is changed or emptied elsewhere.
 * data/upload-manifest.json is just a cache of the ETag the bucket returned
 * for each upload, for a store whose ETags aren't MD5s (recorded only after
 * an upload succeeded, saved even if a later one fails; unusable = ignored).
 * FORCE_SHARD_UPLOAD=1 uploads every shard. Once the new catalog.json is up,
 * remote shards of sets that no longer exist are deleted -- but only after
 * staying orphaned for 48 h (first-seen times live in the manifest; a missing
 * manifest just starts the clocks), and never more than a fifth of them.
 *
 * The bucket's price-history.json is the one copy of the history that
 * outlives this machine, so it's never overwritten by a much smaller local
 * file (see checkHistoryUpload) -- override with FORCE_HISTORY_UPLOAD=1.
 *
 * Requires SUPABASE_S3_* vars (see .env.example) — load with
 * `node --env-file=.env upload-cards.js`.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getBucket, getClient, putFile, headObjectSize, listObjects, deleteObject, normalizeEtag } = require('./s3');
const { writeFileAtomic } = require('./fs-atomic');

const DATA_DIR = path.join(__dirname, 'data');
const DETAILS_DIR = path.join(DATA_DIR, 'details');
const MANIFEST_PATH = path.join(DATA_DIR, 'upload-manifest.json');
const MANIFEST_VERSION = 2; // v1 mapped key -> hash only; it is ignored (every shard is re-checked against the bucket)
const FORCE_SHARDS_ENV = 'FORCE_SHARD_UPLOAD';
const SHARD_CONCURRENCY = 6;
const PUBLIC_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
const HISTORY_KEY = 'price-history.json';
// The canonical history is append-only, so it essentially only grows;
// 10% of slack covers any future compaction of the JSON itself.
const MIN_HISTORY_SHARE = 0.9;
const FORCE_ENV = 'FORCE_HISTORY_UPLOAD';

const OBJECTS = [
  { key: HISTORY_KEY, cacheControl: 'no-store', required: false },
  { key: 'history-public.json', cacheControl: PUBLIC_CACHE_CONTROL, required: false },
  { key: 'movers.json', cacheControl: PUBLIC_CACHE_CONTROL, required: false },
  // Detail shards go between these and catalog.json (see main()).
  { key: 'catalog.json', cacheControl: PUBLIC_CACHE_CONTROL, required: true },
  { key: 'cards.json', cacheControl: PUBLIC_CACHE_CONTROL, required: true },
].map((obj) => ({ ...obj, filePath: path.join(DATA_DIR, obj.key) }));

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const md5 = (buffer) => crypto.createHash('md5').update(buffer).digest('hex');

/**
 * A cache of what this machine last uploaded: { key: { hash, etag } } -- the
 * content hash of each shard and the ETag the bucket answered with. It is
 * only a hint (see planShardUploads: the bucket's own listing decides), so
 * anything unusable -- missing, unparseable, wrong version, written for a
 * different bucket -- yields an empty one, which costs at most some
 * unnecessary re-uploads.
 */
function readManifest(filePath, bucket) {
  const empty = { v: MANIFEST_VERSION, bucket, shards: {}, orphanedSince: {} };
  try {
    const m = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (m && m.v === MANIFEST_VERSION && m.bucket === bucket && m.shards && typeof m.shards === 'object') {
      // key -> ms timestamp the shard was first seen without a local set
      // (see planShardPrune). Unlike the ETag cache this carries state that
      // delays a deletion, so losing it only ever makes deletion later.
      const orphanedSince = m.orphanedSince && typeof m.orphanedSince === 'object' ? { ...m.orphanedSince } : {};
      return { v: MANIFEST_VERSION, bucket, shards: { ...m.shards }, orphanedSince };
    }
  } catch {
    // fall through
  }
  return empty;
}

/**
 * Which local shards need uploading, judged against what the bucket actually
 * holds (one listing per run), so a bucket changed or emptied elsewhere heals
 * itself. A shard is left alone only if it exists remotely AND its remote
 * ETag matches either the MD5 of the local content (a single-part PUT's ETag
 * on S3) or the ETag this machine got back when it last uploaded this exact
 * content (manifest) -- the latter keeps it working on a store whose ETags
 * aren't MD5s, instead of re-uploading everything every run.
 *
 * @param {{key: string, hash: string, md5: string}[]} local
 * @param {Map<string, {etag: string|null}>} remote   from listObjects('details/')
 * @param {{shards: Object<string, {hash: string, etag: string|null}>}} manifest
 * @returns {{toUpload: object[], unchanged: number}}
 */
function planShardUploads(local, remote, manifest, { force = false } = {}) {
  const toUpload = local.filter(({ key, hash, md5: localMd5 }) => {
    if (force) return true;
    const remoteEtag = remote.get(key)?.etag;
    if (!remoteEtag) return true; // missing remotely (or no ETag to compare)
    if (remoteEtag === localMd5) return false;
    const known = manifest.shards[key];
    return !(known && known.hash === hash && known.etag && known.etag === remoteEtag);
  });
  return { toUpload, unchanged: local.length - toUpload.length };
}

// A shard of a vanished set is deleted only once it has stayed orphaned this
// long. Visitors keep a catalog for up to a day, and a scrape that transiently
// drops a small set would otherwise 404 their skill text (the 404 is also
// edge-cached for 5 min); a set that comes back within the window is never
// touched.
const ORPHAN_GRACE_MS = 48 * 60 * 60 * 1000;

/**
 * Which remote shards to delete: those no local shard accounts for (their sets
 * are gone) AND that have been orphaned for at least `minAgeMs`.
 *
 * @param {Object<string, number>} orphanedSince  key -> when first seen orphaned (ms), from the manifest
 * @returns {{toDelete: string[], orphanedSince: Object<string, number>, reason: string|null}}
 *   orphanedSince is the updated record: first-seen times kept, new orphans
 *   stamped `now`, and keys that are no longer orphans (the set came back, or
 *   the object is gone) cleared. Refuses to delete anything (reason set, record
 *   still updated) if more than a fifth of the remote shards are orphaned -- a
 *   half-built local details/ must not empty the bucket.
 */
function planShardPrune(local, remote, orphanedSince = {}, { now = Date.now(), minAgeMs = ORPHAN_GRACE_MS, maxShare = 0.2 } = {}) {
  const localKeys = new Set(local.map((s) => s.key));
  const orphans = [...remote.keys()].filter((k) => /^details\/[a-z0-9-]+\.json$/.test(k) && !localKeys.has(k));
  const record = {};
  for (const key of orphans) {
    const first = orphanedSince[key];
    record[key] = Number.isFinite(first) && first <= now ? first : now;
  }
  if (remote.size > 0 && orphans.length > remote.size * maxShare) {
    return {
      toDelete: [],
      orphanedSince: record,
      reason: `${orphans.length} of ${remote.size} remote shards look orphaned (over ${Math.round(maxShare * 100)}%), not deleting`,
    };
  }
  return { toDelete: orphans.filter((k) => now - record[k] >= minAgeMs), orphanedSince: record, reason: null };
}

/** Local shard files as [{ key: 'details/<slug>.json', filePath, hash }], sorted by key. */
function listLocalShards(dir = DETAILS_DIR) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return names
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const filePath = path.join(dir, name);
      const content = fs.readFileSync(filePath);
      return { key: `details/${name}`, filePath, hash: sha256(content), md5: md5(content) };
    });
}

/** Runs `worker` over `items` with at most `limit` in flight; stops starting new ones after a failure and rethrows it. */
async function runPool(items, limit, worker) {
  let next = 0;
  let failure = null;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failure && next < items.length) {
      const item = items[next++];
      try {
        await worker(item);
      } catch (err) {
        failure = failure || err;
      }
    }
  });
  await Promise.all(lanes);
  if (failure) throw failure;
}

/**
 * Whether the local price-history.json may replace the bucket's copy.
 * Refuses when a remote copy exists and the local file is under 90% of its
 * size: that's a fresh, restored-from-old or re-backfilled local history,
 * and uploading it would silently throw away recorded runs.
 *
 * @param {number|null} localBytes   size of the local file (null = none, nothing to upload)
 * @param {number|null} remoteBytes  ContentLength of the bucket copy (null = none)
 * @returns {{ok: boolean, message: string|null}}
 */
function checkHistoryUpload(localBytes, remoteBytes, { force = false, minShare = MIN_HISTORY_SHARE } = {}) {
  if (!Number.isFinite(localBytes) || !Number.isFinite(remoteBytes)) return { ok: true, message: null };
  if (localBytes >= remoteBytes * minShare) return { ok: true, message: null };
  const detail = `Local ${HISTORY_KEY} is ${localBytes} bytes, under ${Math.round(minShare * 100)}% of the ` +
    `bucket copy's ${remoteBytes} bytes`;
  if (force) return { ok: true, message: `${detail} -- uploading anyway because ${FORCE_ENV}=1.` };
  return {
    ok: false,
    message: `${detail}. The history only grows, so the local file is probably a fresh, stale or ` +
      're-backfilled one -- refusing to upload anything (history-public.json and movers.json come from ' +
      'the same file). To restore the bucket copy, delete data/price-history.json and rerun ' +
      `\`node --env-file=.env record-history.js\`; if the smaller file really is right, rerun with ${FORCE_ENV}=1.`,
  };
}

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function main() {
  // Fail on missing credentials, a missing cards.json or a suspicious
  // history before uploading anything, rather than halfway through.
  getClient();
  getBucket();
  for (const { filePath, required } of OBJECTS) {
    if (required && !fs.existsSync(filePath)) throw new Error(`${filePath} not found -- run build-data.js first`);
  }
  const localHistoryBytes = fileSize(OBJECTS[0].filePath);
  if (localHistoryBytes !== null) {
    const decision = checkHistoryUpload(localHistoryBytes, await headObjectSize(HISTORY_KEY), {
      force: process.env[FORCE_ENV] === '1',
    });
    if (!decision.ok) throw new Error(decision.message);
    if (decision.message) console.warn(`[upload-cards] ${decision.message}`);
  }

  const uploadObject = async ({ key, filePath, cacheControl }) => {
    if (!fs.existsSync(filePath)) {
      console.warn(`[upload-cards] ${filePath} not found -- skipping ${key}.`);
      return;
    }
    const { bucket, bytes } = await putFile(key, filePath, { contentType: 'application/json', cacheControl });
    console.log(`Uploaded ${(bytes / (1024 * 1024)).toFixed(2)} MB to s3://${bucket}/${key}`);
  };

  const firstServed = OBJECTS.findIndex((o) => o.key === 'catalog.json');
  for (const obj of OBJECTS.slice(0, firstServed)) await uploadObject(obj);

  // Shards before the catalog that relies on them: if any shard fails the
  // run throws here and catalog.json (and cards.json) keep their previous
  // objects, so the served catalog never refers to a shard the bucket lacks.
  const shards = await uploadShards();

  for (const obj of OBJECTS.slice(firstServed)) await uploadObject(obj);

  // Only now, with the new catalog live, drop shards of vanished sets.
  await pruneShards(shards);
}


/**
 * Uploads the shards the bucket lacks or holds different content for (see
 * planShardUploads). Everything the S3 side needs is injectable, for tests.
 * Throws on the first failed upload -- after the manifest has been saved with
 * the shards that did succeed -- so the caller never goes on to publish a
 * catalog.json that refers to a missing shard.
 *
 * @returns {Promise<{local: object[], remote: Map, uploaded: number}>}
 */
async function uploadShards({
  bucket = getBucket(),
  local = listLocalShards(),
  listRemote = () => listObjects('details/'),
  put = ({ key, filePath }) => putFile(key, filePath, { contentType: 'application/json', cacheControl: PUBLIC_CACHE_CONTROL }),
  manifestPath = MANIFEST_PATH,
  force = process.env[FORCE_SHARDS_ENV] === '1',
  concurrency = SHARD_CONCURRENCY,
} = {}) {
  if (local.length === 0) throw new Error(`No detail shards in ${DETAILS_DIR} -- run build-data.js first`);
  const remote = await listRemote();
  const manifest = readManifest(manifestPath, bucket);
  const { toUpload, unchanged } = planShardUploads(local, remote, manifest, { force });

  // Forget shards that no longer exist locally (their sets are gone).
  const localKeys = new Set(local.map((s) => s.key));
  for (const key of Object.keys(manifest.shards)) {
    if (!localKeys.has(key)) delete manifest.shards[key];
  }

  let bytes = 0;
  let uploaded = 0;
  try {
    await runPool(toUpload, concurrency, async (shard) => {
      const res = await put(shard);
      bytes += res.bytes;
      uploaded++;
      // Only now is this shard known to be in the bucket.
      manifest.shards[shard.key] = { hash: shard.hash, etag: normalizeEtag(res.etag) };
    });
  } finally {
    // Saved even when a later shard failed, so the next run only redoes
    // what's still missing. (A failed save just costs some re-uploads.)
    try {
      writeFileAtomic(manifestPath, JSON.stringify(manifest));
    } catch (err) {
      console.warn(`[upload-cards] Couldn't save ${manifestPath} (${err.message}).`);
    }
  }
  console.log(
    `Uploaded ${uploaded} of ${local.length} detail shards (${(bytes / (1024 * 1024)).toFixed(2)} MB; ` +
    `${unchanged} already in the bucket)`
  );
  return { local, remote, uploaded, manifest, manifestPath };
}

/**
 * Deletes remote shards of sets that no longer exist -- but only ones that
 * have stayed orphaned for 48 h (see ORPHAN_GRACE_MS), tracked in the
 * manifest's orphanedSince. Run only after the new catalog.json is up, so the
 * live catalog never refers to a deleted shard; a failure here is only a
 * warning (the leftovers are harmless). With no manifest yet nothing has a
 * first-seen time, so the first run only records.
 */
async function pruneShards({
  local, remote, manifest, manifestPath = MANIFEST_PATH, remove = deleteObject, now = Date.now(),
} = {}) {
  const plan = planShardPrune(local, remote, manifest.orphanedSince, { now });
  if (plan.reason) console.warn(`[upload-cards] ${plan.reason}.`);
  manifest.orphanedSince = plan.orphanedSince;
  let deleted = 0;
  for (const key of plan.toDelete) {
    try {
      await remove(key);
      deleted++;
      delete manifest.orphanedSince[key];
    } catch (err) {
      console.warn(`[upload-cards] Couldn't delete orphaned ${key} (${err.message}); it will be retried next run.`);
    }
  }
  const waiting = Object.keys(manifest.orphanedSince).length;
  if (plan.toDelete.length > 0) console.log(`Deleted ${deleted} of ${plan.toDelete.length} orphaned remote shards.`);
  if (waiting > 0) console.log(`${waiting} orphaned remote shard(s) waiting out the ${ORPHAN_GRACE_MS / 3600000} h grace period.`);
  try {
    writeFileAtomic(manifestPath, JSON.stringify(manifest));
  } catch (err) {
    console.warn(`[upload-cards] Couldn't save ${manifestPath} (${err.message}).`);
  }
  return deleted;
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[upload-cards] Failed:', err.message);
    process.exit(1);
  });
}

module.exports = {
  checkHistoryUpload,
  MIN_HISTORY_SHARE,
  readManifest,
  planShardUploads,
  planShardPrune,
  ORPHAN_GRACE_MS,
  uploadShards,
  pruneShards,
  listLocalShards,
  runPool,
  OBJECTS,
};
