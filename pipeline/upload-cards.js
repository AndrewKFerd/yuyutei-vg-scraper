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
 *  - cards.json           served via /api/cards (required)
 * The history files go first so the backup lands even if a later upload
 * fails. A missing history/movers file is skipped with a warning (e.g.
 * before the history has been seeded); any upload error exits 1.
 *
 * The bucket's price-history.json is the one copy of the history that
 * outlives this machine, so it's never overwritten by a much smaller local
 * file (see checkHistoryUpload) -- override with FORCE_HISTORY_UPLOAD=1.
 *
 * Requires SUPABASE_S3_* vars (see .env.example) — load with
 * `node --env-file=.env upload-cards.js`.
 */

const fs = require('fs');
const path = require('path');
const { getBucket, getClient, putFile, headObjectSize } = require('./s3');

const DATA_DIR = path.join(__dirname, 'data');
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
  { key: 'cards.json', cacheControl: PUBLIC_CACHE_CONTROL, required: true },
].map((obj) => ({ ...obj, filePath: path.join(DATA_DIR, obj.key) }));

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

  for (const { key, filePath, cacheControl } of OBJECTS) {
    if (!fs.existsSync(filePath)) {
      console.warn(`[upload-cards] ${filePath} not found -- skipping ${key}.`);
      continue;
    }
    const { bucket, bytes } = await putFile(key, filePath, { contentType: 'application/json', cacheControl });
    console.log(`Uploaded ${(bytes / (1024 * 1024)).toFixed(2)} MB to s3://${bucket}/${key}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[upload-cards] Failed:', err.message);
    process.exit(1);
  });
}

module.exports = { checkHistoryUpload, MIN_HISTORY_SHARE };
