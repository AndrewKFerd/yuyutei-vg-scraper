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
 *  - cards.json           the full catalog, served via /api/cards (required).
 *                         Transition only: the frontend deployed before the
 *                         catalog split still loads it. Drop this entry once
 *                         the split frontend is live (README: "Catalog split")
 * The history files go first so the backup lands even if a later upload
 * fails. A missing history/movers file is skipped with a warning (e.g.
 * before the history has been seeded); any upload error exits 1.
 *
 * The ~300 shards are rarely all different, so data/upload-manifest.json
 * remembers the content hash of each shard that was uploaded successfully
 * (recorded only after that upload succeeded, saved even if a later one
 * fails). A missing, corrupt or other-bucket manifest means "upload every
 * shard"; FORCE_SHARD_UPLOAD=1 does the same on demand (e.g. after emptying
 * the bucket).
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
const { getBucket, getClient, putFile, headObjectSize } = require('./s3');
const { writeFileAtomic } = require('./fs-atomic');

const DATA_DIR = path.join(__dirname, 'data');
const DETAILS_DIR = path.join(DATA_DIR, 'details');
const MANIFEST_PATH = path.join(DATA_DIR, 'upload-manifest.json');
const MANIFEST_VERSION = 1;
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

/**
 * The manifest of successfully uploaded shards ({ key: content hash }).
 * Anything unusable -- missing, unparseable, wrong version, written for a
 * different bucket -- yields an empty one, i.e. "upload everything".
 */
function readManifest(filePath, bucket) {
  const empty = { v: MANIFEST_VERSION, bucket, shards: {} };
  try {
    const m = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (m && m.v === MANIFEST_VERSION && m.bucket === bucket && m.shards && typeof m.shards === 'object') {
      return { v: MANIFEST_VERSION, bucket, shards: { ...m.shards } };
    }
  } catch {
    // fall through
  }
  return empty;
}

/**
 * Which local shards need uploading.
 * @param {{key: string, hash: string}[]} local
 * @param {{shards: Object<string, string>}} manifest
 * @returns {{toUpload: {key: string, hash: string}[], unchanged: number}}
 */
function planShardUploads(local, manifest, { force = false } = {}) {
  const toUpload = local.filter(({ key, hash }) => force || manifest.shards[key] !== hash);
  return { toUpload, unchanged: local.length - toUpload.length };
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
      return { key: `details/${name}`, filePath, hash: sha256(fs.readFileSync(filePath)) };
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
  await uploadShards();

  for (const obj of OBJECTS.slice(firstServed)) await uploadObject(obj);
}

async function uploadShards() {
  const bucket = getBucket();
  const local = listLocalShards();
  if (local.length === 0) throw new Error(`No detail shards in ${DETAILS_DIR} -- run build-data.js first`);
  const manifest = readManifest(MANIFEST_PATH, bucket);
  const { toUpload, unchanged } = planShardUploads(local, manifest, { force: process.env[FORCE_SHARDS_ENV] === '1' });

  // Forget shards that no longer exist locally (their sets are gone).
  const localKeys = new Set(local.map((s) => s.key));
  for (const key of Object.keys(manifest.shards)) {
    if (!localKeys.has(key)) delete manifest.shards[key];
  }

  let bytes = 0;
  try {
    await runPool(toUpload, SHARD_CONCURRENCY, async ({ key, filePath, hash }) => {
      const res = await putFile(key, filePath, { contentType: 'application/json', cacheControl: PUBLIC_CACHE_CONTROL });
      bytes += res.bytes;
      // Only now is this shard known to be in the bucket.
      manifest.shards[key] = hash;
    });
  } finally {
    // Saved even when a later shard failed, so the next run only redoes
    // what's still missing. (A failed save just means re-uploading some.)
    try {
      writeFileAtomic(MANIFEST_PATH, JSON.stringify(manifest));
    } catch (err) {
      console.warn(`[upload-cards] Couldn't save ${MANIFEST_PATH} (${err.message}); the next run re-uploads shards.`);
    }
  }
  console.log(
    `Uploaded ${toUpload.length} of ${local.length} detail shards (${(bytes / (1024 * 1024)).toFixed(2)} MB; ` +
    `${unchanged} unchanged)`
  );
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
  listLocalShards,
  runPool,
  OBJECTS,
};
