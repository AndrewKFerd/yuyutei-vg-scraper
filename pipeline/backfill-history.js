'use strict';

/**
 * One-off: seeds data/price-history.json from the cards.json snapshots
 * still in git history (committed every refresh, Sep 15 -> Sep 18 2026,
 * before the catalog moved to Supabase Storage). Replays them oldest-first
 * through the same recorder record-history.js uses, stamped with each
 * snapshot's generatedAt, so the charts start with those days of history
 * instead of empty. The stretch from the last snapshot to the first live
 * run is recorded honestly as a coverage gap.
 *
 * Two corrections are applied to the snapshots before replaying them:
 *  - the ones from before the scraper learned yuyu-tei's "◯"
 *    always-available marker recorded it as stock 0 (repairPreSentinelStock);
 *  - a snapshot committed by a feature commit (not the scheduled refresh)
 *    whose listings/prices/stocks are identical to the previous one is a
 *    rebuild of the same scrape (generatedAt is build time), not a new
 *    observation, so it's skipped (isRebuild).
 *
 * Writes locally only -- it does NOT upload; the next refresh's
 * upload-cards.js pushes the result to the bucket. So it must only run when
 * no history exists anywhere yet: it checks the bucket first and refuses if
 * price-history.json is already there (a backfilled file would be far
 * smaller than a real one; upload-cards.js would refuse it too, but better
 * not to create it). On a machine that merely lacks the local file,
 * record-history.js restores the bucket copy instead.
 *
 * Usage: node --env-file=.env backfill-history.js [flags]   (npm run history:backfill)
 *   --force            overwrite an existing local data/price-history.json
 *                      (the old one is kept as price-history.prev.json)
 *   --force-remote     proceed even though the bucket already has a history
 *   --no-remote-check  proceed without SUPABASE_S3_* env vars, i.e. without
 *                      checking the bucket (only when you know it's empty,
 *                      or for local testing)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const {
  toMinute,
  minuteToIso,
  createEmptyHistory,
  observationsFromBuiltCards,
  appendObservation,
} = require('./price-history');
const { checkCatalogSize, allowShrinkFromEnv } = require('./catalog-gate');
const { writeFileAtomic, HISTORY_PATH, PREV_PATH, HISTORY_OBJECT_KEY } = require('./record-history');
const s3 = require('./s3');

const REPO_ROOT = path.join(__dirname, '..');
const SNAPSHOT_PATH = 'frontend/public/data/cards.json';
// Each snapshot is ~27 MB of JSON; leave generous headroom.
const MAX_BUFFER = 512 * 1024 * 1024;

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: MAX_BUFFER, ...opts });
}

/**
 * Decides whether it's safe to create a history that will later be
 * uploaded over the bucket's copy. IO is injected for testing:
 *   hasRemote()  -> whether bucket credentials are configured
 *   remoteSize() -> Promise of the bucket copy's size, null if there is none;
 *                   rejects on network/auth errors
 * @returns {Promise<{ok: boolean, message: string|null}>}
 */
async function checkRemoteBeforeBackfill({ hasRemote, remoteSize, forceRemote = false, noRemoteCheck = false }) {
  if (!hasRemote()) {
    if (noRemoteCheck) {
      return { ok: true, message: '--no-remote-check: not checking the bucket for an existing history.' };
    }
    return {
      ok: false,
      message: 'No SUPABASE_S3_* env vars, so the bucket can\'t be checked for an existing history (which ' +
        'this backfill would later overwrite). Rerun with --env-file=.env, or pass --no-remote-check if ' +
        'you know the bucket has none.',
    };
  }
  let size;
  try {
    size = await remoteSize();
  } catch (err) {
    return {
      ok: false,
      message: `Checking the bucket for ${HISTORY_OBJECT_KEY} failed (${err.name || 'Error'}: ${err.message}) -- ` +
        'refusing to backfill without knowing whether a real history exists there.',
    };
  }
  if (size === null || size === undefined) return { ok: true, message: null };
  if (forceRemote) {
    return { ok: true, message: `The bucket already has a ${size}-byte ${HISTORY_OBJECT_KEY}; continuing because of --force-remote.` };
  }
  return {
    ok: false,
    message: `The bucket already has a ${size}-byte ${HISTORY_OBJECT_KEY} -- the real history. Refusing to ` +
      'backfill over it; `node --env-file=.env record-history.js` restores it locally instead. ' +
      '(--force-remote overrides this.)',
  };
}

/** Order-independent digest of what a snapshot observed: (id, price, stock) per listing. */
function contentSignature(observations) {
  const lines = observations.map((o) => `${o.id}\t${o.price}\t${o.stock}`).sort();
  return crypto.createHash('sha1').update(lines.join('\n'), 'utf8').digest('hex');
}

// Commit subject the old scheduled refresh used for every snapshot it
// committed, e.g. "Update card catalog (2026-09-17T22:12 local)".
const SCHEDULED_REFRESH_RE = /^Update card catalog\b/;

/**
 * A snapshot is a rebuild -- build-data.js rerun on an already-committed
 * scrape, e.g. to ship new skill text -- when its (id, price, stock)
 * content matches the previous accepted snapshot AND it wasn't committed by
 * the scheduled refresh. Identical content alone isn't enough: nine of the
 * Sep 17 refreshes genuinely scraped yuyu-tei 30 min after the last one and
 * saw no change, and dropping those would shade observed time as a gap.
 */
function isRebuild(snap, prev) {
  return Boolean(prev) && !SCHEDULED_REFRESH_RE.test(snap.subject || '') && snap.signature === prev.signature;
}

function loadSnapshot(sha, subject) {
  const payload = JSON.parse(git(['show', `${sha}:${SNAPSHOT_PATH}`]));
  const observedAt = toMinute(Date.parse(payload.generatedAt));
  if (!Number.isFinite(observedAt)) throw new Error(`no valid generatedAt (${JSON.stringify(payload.generatedAt)})`);
  if (!Array.isArray(payload.cards)) throw new Error('no cards array');
  const observations = observationsFromBuiltCards(payload.cards);
  // Every committed snapshot uses build-data.js's composite
  // `${setSlug}/${id}`; a bare per-set number would silently become a
  // different listing than the live runs record, so reject rather than guess.
  const bare = observations.filter((o) => typeof o.id !== 'string' || !o.id.includes('/')).length;
  if (bare) throw new Error(`${bare} card id(s) are not composite setSlug/id`);
  return { sha, subject, observedAt, observations };
}

// A snapshot counts as having the "◯" -> null fix once at least this share
// of its listings are null (44% on the first real one, vs 0.06% on the
// half-rebuilt snapshot committed alongside the fix).
const SENTINEL_BULK_SHARE = 0.01;

/**
 * Until commit 1f45559 ("Fix unlimited-stock cards showing as out of
 * stock", 2026-09-17) the scraper parsed yuyu-tei's "◯" always-available
 * marker as stock 0; from the 2026-09-17T14:39Z snapshot on it's null.
 * Replayed as-is, that fix would enter the canonical history as ~12,300
 * listings restocking at one instant, and bulk commons would chart as sold
 * out for their first two days. So, in the snapshots before the first one
 * with the marker in bulk, a 0 is read as null for every listing that
 * snapshot shows as "◯". (A listing genuinely out of stock back then that
 * later became "◯" is indistinguishable -- and rare, since "◯" is the
 * never-runs-out bulk tier.) Expects `snapshots` sorted ascending; mutates
 * their observations.
 */
function repairPreSentinelStock(snapshots) {
  const nullCount = (s) => s.observations.reduce((n, o) => n + (o.stock === null ? 1 : 0), 0);
  const fixedIdx = snapshots.findIndex((s) =>
    s.observations.length > 0 && nullCount(s) >= s.observations.length * SENTINEL_BULK_SHARE);
  if (fixedIdx <= 0) return { fixedIdx, repaired: 0 };
  const alwaysAvailable = new Set(
    snapshots[fixedIdx].observations.filter((o) => o.stock === null).map((o) => o.id)
  );
  let repaired = 0;
  for (const snap of snapshots.slice(0, fixedIdx)) {
    for (const o of snap.observations) {
      if (o.stock === 0 && alwaysAvailable.has(o.id)) {
        o.stock = null;
        repaired++;
      }
    }
  }
  return { fixedIdx, repaired };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (fs.existsSync(HISTORY_PATH) && !args.has('--force')) {
    throw new Error(
      `${HISTORY_PATH} already exists -- refusing to overwrite recorded history. ` +
      'Rerun with --force if you really mean to rebuild it from the git snapshots.'
    );
  }
  const remote = await checkRemoteBeforeBackfill({
    hasRemote: () => s3.hasS3Env(),
    remoteSize: () => s3.headObjectSize(HISTORY_OBJECT_KEY),
    forceRemote: args.has('--force-remote'),
    noRemoteCheck: args.has('--no-remote-check'),
  });
  if (!remote.ok) throw new Error(remote.message);
  if (remote.message) console.warn(`[backfill-history] ${remote.message}`);

  const commits = git(['log', '--format=%H%x09%s', '--diff-filter=AM', '--', SNAPSHOT_PATH])
    .split('\n').map((line) => line.trim()).filter(Boolean)
    .map((line) => {
      const [sha, ...rest] = line.split('\t');
      return { sha, subject: rest.join('\t') };
    });
  console.log(`[backfill-history] Found ${commits.length} snapshot(s) of ${SNAPSHOT_PATH} in git history.`);

  // Only the few fields the recorder needs are kept from each ~27 MB
  // snapshot, so holding all of them for sorting stays cheap.
  const snapshots = [];
  let unreadable = 0;
  for (const { sha, subject } of commits) {
    try {
      snapshots.push(loadSnapshot(sha, subject));
    } catch (err) {
      unreadable++;
      console.warn(`[backfill-history] Skipping ${sha.slice(0, 7)}: unreadable snapshot (${err.message}).`);
    }
  }
  snapshots.sort((a, b) => a.observedAt - b.observedAt);

  const { fixedIdx, repaired } = repairPreSentinelStock(snapshots);
  if (repaired > 0) {
    console.log(
      `[backfill-history] Read ${repaired} pre-fix stock 0 value(s) as "◯" (null) across the ${fixedIdx} ` +
      `snapshot(s) before ${minuteToIso(snapshots[fixedIdx].observedAt)}, the first with the "◯" marker in bulk.`
    );
  }

  const history = createEmptyHistory();
  const totals = { newCards: 0, priceChanges: 0, stockChanges: 0, pendingJumps: 0, confirmedJumps: 0, renamed: 0 };
  let replayed = 0;
  let duplicates = 0;
  let rebuilds = 0;
  let gated = 0;
  let prev = null; // the previous *accepted* snapshot: { sha, observedAt, count, signature }
  for (const snap of snapshots) {
    const label = `${snap.sha.slice(0, 7)} (${minuteToIso(snap.observedAt)}, ${snap.observations.length} cards)`;
    if (prev && snap.observedAt === prev.observedAt) {
      duplicates++;
      console.warn(`[backfill-history] Skipping ${label}: same minute as the previous snapshot.`);
      continue;
    }
    // Same run gate as live runs, against the previous accepted snapshot:
    // an empty/partial catalog must not be replayed as mass changes.
    const gate = checkCatalogSize(snap.observations.length, prev?.count, { allowShrink: allowShrinkFromEnv() });
    if (!gate.ok) {
      gated++;
      console.warn(`[backfill-history] Skipping ${label}: ${gate.message}`);
      continue;
    }
    if (gate.message) console.warn(`[backfill-history] ${label}: ${gate.message}`);
    // A rebuild of an already-replayed scrape observed nothing new;
    // recording it as a run would claim coverage at a time nobody looked at
    // yuyu-tei.
    snap.signature = contentSignature(snap.observations);
    if (isRebuild(snap, prev)) {
      rebuilds++;
      console.log(
        `[backfill-history] Skipping ${label}: same listings/prices/stock as ${prev.sha.slice(0, 7)} ` +
        `(${minuteToIso(prev.observedAt)}) -- a rebuild ("${snap.subject}"), not a new scrape.`
      );
      continue;
    }

    const stats = appendObservation(history, snap.observations, snap.observedAt, { rawCount: snap.observations.length });
    for (const k of Object.keys(totals)) totals[k] += stats[k];
    if (stats.massRename) console.warn(`[backfill-history] ${label}: mass rename detected (hashes updated, no resets).`);
    replayed++;
    prev = { sha: snap.sha, observedAt: snap.observedAt, count: snap.observations.length, signature: snap.signature };
  }

  if (replayed === 0) throw new Error('No usable snapshots -- nothing written.');

  try {
    if (fs.existsSync(HISTORY_PATH)) fs.copyFileSync(HISTORY_PATH, PREV_PATH);
  } catch (err) {
    console.warn(`[backfill-history] Couldn't copy the existing history to ${PREV_PATH} (${err.message}); continuing.`);
  }
  writeFileAtomic(HISTORY_PATH, JSON.stringify(history));

  const series = Object.values(history.cards);
  const changed = series.filter((s) => s.length > 1).length;
  const sizeMb = fs.statSync(HISTORY_PATH).size / (1024 * 1024);
  console.log(
    `[backfill-history] Replayed ${replayed} snapshot(s); skipped ${rebuilds} rebuild(s), ${duplicates} same-minute, ` +
    `${gated} failing the run gate, ${unreadable} unreadable.`
  );
  console.log(
    `[backfill-history] Tracking since ${minuteToIso(history.trackingSince)}, last run ` +
    `${minuteToIso(history.runs[history.runs.length - 1])}; ${series.length} listings, ${changed} with more than one entry.`
  );
  console.log(
    `[backfill-history] Events: ${totals.priceChanges} price change(s), ${totals.stockChanges} stock-only change(s), ` +
    `${totals.newCards} listing(s) first seen, ${totals.pendingJumps} jump(s) held for confirmation ` +
    `(${totals.confirmedJumps} confirmed), ${totals.renamed} renamed.`
  );
  const pendingLeft = Object.keys(history.pending).length;
  if (pendingLeft) console.log(`[backfill-history] ${pendingLeft} jump(s) still awaiting confirmation by the next run.`);
  console.log(`[backfill-history] Wrote ${HISTORY_PATH} (${sizeMb.toFixed(2)} MB). Not uploaded.`);
  console.log('Next: node --env-file=.env record-history.js');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[backfill-history] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { repairPreSentinelStock, checkRemoteBeforeBackfill, contentSignature, isRebuild };
