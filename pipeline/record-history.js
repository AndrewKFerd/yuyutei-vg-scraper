'use strict';

/**
 * Records this run's catalog-raw.json into the price history, then writes
 * the two served derivatives for upload-cards.js to push:
 *
 *   data/price-history.json   full canonical change log (private; uploaded
 *                             to the bucket only as a backup)
 *   data/history-public.json  listings that have changed, for the card
 *                             modal's chart (via /api/history)
 *   data/movers.json          24h/7d/30d leaderboards (via /api/movers)
 *
 * Runs straight after scrape-catalog.js in refresh-and-push.ps1, so the
 * gates here abort a bad scrape before the slow cf-vanguard scrape and
 * before anything is uploaded:
 *   - run gate: the catalog must have >= 98% of the largest card count seen
 *     in the last 7 days of runs (catalog-gate.js);
 *   - content gate: >= 90% of listings must have a parseable price, and at
 *     most 25% of already-tracked listings may have changed since their
 *     last entry (checkObservationSanity in price-history.js).
 * The recording rules themselves live in price-history.js.
 *
 * The history is the one dataset in this project that can't be
 * regenerated, so this never silently starts a fresh one: a missing local
 * file is restored from the bucket (which is why it needs --env-file=.env
 * even though it uploads nothing), and only when the bucket was checked and
 * has no copy either may HISTORY_INIT=1 start an empty one on purpose. It
 * also keeps a dated local copy per day in data/history-backups/ (newest
 * 14).
 *
 * Usage: node --env-file=.env record-history.js   (npm run history:record)
 *   ALLOW_CATALOG_SHRINK=1  accept a catalog >2% smaller than recent runs
 *                           (and make it the new baseline)
 *   ALLOW_MASS_CHANGE=1     record a run the content gate rejected
 *   HISTORY_INIT=1          start an empty history if the bucket has none
 */

const fs = require('fs');
const path = require('path');

const {
  toMinute,
  minuteToIso,
  createEmptyHistory,
  normalizeHistory,
  gateBaseline,
  checkObservationSanity,
  allowMassChangeFromEnv,
  observationsFromCatalog,
  appendObservation,
  buildPublicHistory,
  buildMovers,
} = require('./price-history');
const { checkCatalogSize, allowShrinkFromEnv } = require('./catalog-gate');
const { writeFileAtomic } = require('./fs-atomic');
const s3 = require('./s3');

const DATA_DIR = path.join(__dirname, 'data');
const CATALOG_PATH = path.join(DATA_DIR, 'catalog-raw.json');
const HISTORY_PATH = path.join(DATA_DIR, 'price-history.json');
const PREV_PATH = path.join(DATA_DIR, 'price-history.prev.json');
const BACKUP_DIR = path.join(DATA_DIR, 'history-backups');
const PUBLIC_PATH = path.join(DATA_DIR, 'history-public.json');
const MOVERS_PATH = path.join(DATA_DIR, 'movers.json');
const HISTORY_OBJECT_KEY = 'price-history.json';
const BACKUPS_KEPT = 14;
const BACKUP_FILE_RE = /^price-history-\d{4}-\d{2}-\d{2}\.json$/;

/** An expected, explained failure -- printed without a stack trace. */
class FatalError extends Error {}

function readFileOrNull(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** YYYY-MM-DD in this machine's local time zone. */
function localDate(minute) {
  const d = new Date(minute * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Dated local safety net on top of the .prev copy and the bucket: on the
 * first recorded run of each day, copies the freshly written history to
 * <backupDir>/price-history-<date>.json, then deletes all but the newest
 * `keep`. Returns the backup's path, or null if today's already exists.
 */
function backupDaily(historyPath, backupDir, date, keep = BACKUPS_KEPT) {
  const target = path.join(backupDir, `price-history-${date}.json`);
  if (fs.existsSync(target)) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(historyPath, target);
  const backups = fs.readdirSync(backupDir).filter((f) => BACKUP_FILE_RE.test(f)).sort().reverse();
  for (const old of backups.slice(keep)) fs.rmSync(path.join(backupDir, old), { force: true });
  return target;
}

function parseHistory(raw, label) {
  try {
    return normalizeHistory(JSON.parse(raw));
  } catch (err) {
    throw new FatalError(
      `The ${label} is unreadable (${err.message}) -- refusing to start a fresh history over it. ` +
      'Restore a copy from data/price-history.prev.json or data/history-backups/, or delete ' +
      'data/price-history.json and rerun with --env-file=.env to restore the bucket copy.'
    );
  }
}

/**
 * Resolves the history to record into. The IO is injected so each branch
 * can be unit-tested without a disk or network:
 *   readLocal()   -> file contents, or null if there's no local file
 *   hasRemote()   -> whether bucket credentials are configured
 *   fetchRemote() -> Promise of contents (Buffer/string), null if the bucket
 *                    has no such object; rejects on network/auth errors
 *   init          -> HISTORY_INIT=1: may start empty, but only once the
 *                    bucket was checked and has no copy
 * Resolves to { history, source: 'local'|'remote'|'init', raw? } (raw = the
 * remote contents, for the caller to save locally); rejects with a
 * FatalError otherwise.
 */
async function loadHistory({ readLocal, hasRemote, fetchRemote, init }) {
  const local = readLocal();
  if (local !== null && local !== undefined) {
    return { history: parseHistory(local, 'local data/price-history.json'), source: 'local' };
  }

  // Without credentials we can't know whether the bucket holds the
  // canonical history, and a fresh local one would overwrite it on the next
  // upload -- so there's exactly one fix to suggest.
  if (!hasRemote()) {
    throw new FatalError(
      'No local data/price-history.json, and no SUPABASE_S3_* env vars to check the bucket for one. ' +
      'Rerun with --env-file=.env (node --env-file=.env record-history.js) so the bucket copy can be restored.'
    );
  }

  let remote;
  try {
    remote = await fetchRemote();
  } catch (err) {
    // Can't tell whether a remote copy exists, so starting fresh (even
    // with HISTORY_INIT=1) could orphan it -- stop instead.
    throw new FatalError(
      `No local data/price-history.json, and checking the bucket for ${HISTORY_OBJECT_KEY} failed ` +
      `(${err.name || 'Error'}: ${err.message}). Refusing to continue; fix the connection/credentials and rerun.`
    );
  }
  if (remote !== null && remote !== undefined) {
    const raw = Buffer.isBuffer(remote) ? remote.toString('utf8') : String(remote);
    return { history: parseHistory(raw, `bucket copy of ${HISTORY_OBJECT_KEY}`), source: 'remote', raw };
  }

  if (init) return { history: createEmptyHistory(), source: 'init' };
  throw new FatalError(
    'No price history found locally or in the bucket. Run `node --env-file=.env backfill-history.js` ' +
    'first to seed it from the git snapshots, or set HISTORY_INIT=1 to deliberately start an empty history.'
  );
}

function readCatalog() {
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  } catch (err) {
    throw new FatalError(`Can't read ${CATALOG_PATH} (${err.message}) -- run scrape-catalog.js first.`);
  }
  if (!catalog || !Array.isArray(catalog.cards)) {
    throw new FatalError(`${CATALOG_PATH} has no cards array -- refusing to record it.`);
  }
  const observedAt = toMinute(Date.parse(catalog.scrapedAt));
  if (!Number.isFinite(observedAt)) {
    throw new FatalError(`${CATALOG_PATH} has no valid scrapedAt (${JSON.stringify(catalog.scrapedAt)}).`);
  }
  return { cards: catalog.cards, observedAt };
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function main() {
  const { cards, observedAt } = readCatalog();

  const { history, source, raw } = await loadHistory({
    readLocal: () => readFileOrNull(HISTORY_PATH),
    hasRemote: () => s3.hasS3Env(),
    fetchRemote: () => s3.getObjectBuffer(HISTORY_OBJECT_KEY),
    init: process.env.HISTORY_INIT === '1',
  });
  if (source === 'remote') {
    writeFileAtomic(HISTORY_PATH, raw);
    console.log(`[record-history] No local price history -- restored ${HISTORY_PATH} from the bucket.`);
  } else if (source === 'init') {
    console.warn('[record-history] HISTORY_INIT=1 and the bucket has no price history: starting an empty one.');
  }

  const gate = checkCatalogSize(cards.length, gateBaseline(history), { allowShrink: allowShrinkFromEnv() });
  if (!gate.ok) throw new FatalError(gate.message);
  if (gate.message) console.warn(`[record-history] ${gate.message}`);

  const observations = observationsFromCatalog(cards);
  const sanity = checkObservationSanity(history, observations, cards.length, { allowMassChange: allowMassChangeFromEnv() });
  if (!sanity.ok) throw new FatalError(sanity.message);
  if (sanity.message) console.warn(`[record-history] ${sanity.message}`);

  const stats = appendObservation(history, observations, observedAt, {
    rawCount: cards.length,
    // An intentionally accepted shrink becomes the baseline going forward.
    resetCountBaseline: gate.overridden,
  });
  const lastRun = history.runs[history.runs.length - 1];

  if (stats.skipped) {
    // Re-running on an already-recorded catalog: leave the canonical file
    // (and its .prev backup) alone, just refresh the derived files below.
    console.log(
      `[record-history] Catalog scraped at ${minuteToIso(observedAt)} is not newer than the last ` +
      `recorded run (${minuteToIso(lastRun)}) -- nothing to record.`
    );
  } else {
    console.log(
      `[record-history] Recorded run at ${minuteToIso(observedAt)}: ${stats.newCards} new listing(s), ` +
      `${stats.priceChanges} price change(s), ${stats.stockChanges} stock-only change(s), ` +
      `${stats.pendingJumps} jump(s) awaiting confirmation, ${stats.confirmedJumps} confirmed, ` +
      `${stats.pendingRenames} rename(s) awaiting confirmation, ${stats.renamed} renamed` +
      `${stats.massRename ? ' (mass rename: hashes updated, no series reset)' : ''} ` +
      `[${sanity.changed} of ${sanity.comparable} tracked listings changed].`
    );
    // Backups are a safety net: failing to make one must not cost the run.
    try {
      if (fs.existsSync(HISTORY_PATH)) fs.copyFileSync(HISTORY_PATH, PREV_PATH);
    } catch (err) {
      console.warn(`[record-history] Couldn't copy the previous history to ${PREV_PATH} (${err.message}); continuing.`);
    }
    writeFileAtomic(HISTORY_PATH, JSON.stringify(history));
    try {
      const backup = backupDaily(HISTORY_PATH, BACKUP_DIR, localDate(observedAt));
      if (backup) console.log(`[record-history] Daily backup: ${backup}`);
    } catch (err) {
      console.warn(`[record-history] Couldn't write the daily backup in ${BACKUP_DIR} (${err.message}); continuing.`);
    }
  }

  const generatedAt = new Date().toISOString();
  const publicHistory = buildPublicHistory(history, { generatedAt });
  const movers = buildMovers(history, observations, { generatedAt });
  writeFileAtomic(PUBLIC_PATH, JSON.stringify(publicHistory));
  writeFileAtomic(MOVERS_PATH, JSON.stringify(movers));

  console.log(
    `[record-history] ${Object.keys(history.cards).length} listings tracked over ${history.runs.length} run(s) ` +
    `since ${minuteToIso(history.trackingSince)}; ${Object.keys(publicHistory.cards).length} have changed.`
  );
  for (const [name, w] of Object.entries(movers.windows)) {
    console.log(
      `[record-history] movers ${name}${w.complete ? '' : ' (partial)'}: ${w.priceChanges.length} price change(s), ` +
      `${w.soldOut.length} sold out, ${w.restocked.length} restocked, ${w.sellingFast.length} selling fast`
    );
  }
  for (const p of [HISTORY_PATH, PUBLIC_PATH, MOVERS_PATH]) {
    console.log(`[record-history] ${path.basename(p)}: ${formatMb(fs.statSync(p).size)}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[record-history] ${err instanceof FatalError ? err.message : err.stack || err}`);
    process.exit(1);
  });
}

module.exports = {
  FatalError,
  loadHistory,
  readFileOrNull,
  writeFileAtomic,
  backupDaily,
  localDate,
  HISTORY_PATH,
  PREV_PATH,
  HISTORY_OBJECT_KEY,
};
