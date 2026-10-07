'use strict';

/**
 * Fetches every card's own yuyu-tei detail page (the `detailUrl` collected by
 * scrape-catalog.js) for its Japanese rules text and stat line -- none of
 * which appear in the global search listing.
 *
 * ## Markup (verified against live pages, 2026-09)
 *
 * The detail page has an attribute <table>. Stat rows pair <th> labels with
 * <td> values, up to two pairs per row:
 *
 *   <tr><th>カード種別</th><td>ノーマルユニット</td><th>グレード</th><td>3</td></tr>
 *   <tr><th>パワー</th><td>13000</td><th>シールド</th><td>...</td></tr>
 *
 * Long-text fields use TWO rows -- a lone <th colspan=4> label row, then a
 * <td colspan=4 class="text-item-detail"> value row:
 *
 *   <tr><th colspan="4">効果</th></tr>
 *   <tr><td colspan="4" class="text-item-detail">【自】：このユニットが...</td></tr>
 *
 * (A mobile copy of the same table with one pair per row also exists on the
 * page; parsing every row and keeping the first non-empty value per label
 * handles both without caring which is which.)
 *
 * Empty values are "" or "-". yuyu-tei populates these for established sets
 * but NOT yet for a just-released set (e.g. DZ-BT16 at time of writing had
 * "-" for every card's 効果 and blank stats), so a miss on a new set is
 * expected and gets retried on a later run rather than cached as final.
 *
 * ## Runtime
 *
 * One request per *card*, not per listing: foil/parallel/signed variants
 * share identical text, so listings are grouped by card-group.js's key
 * (~17k groups for ~28k listings) and one representative page is fetched
 * per group. Output is keyed by that group key; build-data.js copies each
 * result to every listing in the group. Checkpoints to disk every
 * CHECKPOINT_EVERY cards. A re-run skips cards that already have effect
 * text, so an interrupted run resumes. --force refetches every card in
 * scope (combine with --sets/--limit to narrow it); either way results are
 * merged into the existing file, never replacing cards outside the run.
 * An unreadable checkpoint stops the run rather than starting over, since
 * the first checkpoint write would otherwise overwrite hours of results.
 *
 * Usage:
 *   node scrape-card-detail.js                       # full run (resumable)
 *   node scrape-card-detail.js --limit 20             # smoke test
 *   node scrape-card-detail.js --sets dzss19,dzbt16   # only these setSlugs
 *   node scrape-card-detail.js --force                # refetch cards that already have text
 *   node scrape-card-detail.js --missing              # only cards a fetch could fill in (see below)
 *
 * ## Cards with no text
 *
 * A plain run already skips cards that have effect text and retries the rest,
 * but "the rest" is mostly cards whose yuyu-tei page is complete and simply
 * has no 効果 (gift markers, tokens, vanilla units) -- thousands of requests
 * that can only come back "-" again. --missing skips those (classifyEntry),
 * and cards the last build already gave English text, so it queues just the
 * never-fetched cards and the ones fetched while the page was still blank.
 * It combines with --sets and --limit.
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { createCookieJar, browserGet } = require('./http-client');
const { groupKey, isPlainPrinting } = require('./card-group');
const { writeFileAtomic } = require('./fs-atomic');

const SITE_ROOT = 'https://yuyu-tei.jp/';

// yuyu-tei's limiter is unforgiving: 3 workers @ 350ms (~8 req/s) tripped
// HTTP 429 within a minute and then blocked the IP for ~12 minutes, and
// once flagged even ~3 req/s re-tripped it immediately. One worker at
// ~0.9 req/s is the pace that holds. On any 429 the worker backs off with
// a doubling cooldown rather than burning retries. Slow, but resumable.
const WORKERS = 1;
const DELAY_MS = 1100;
const COOLDOWN_MS = 20000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 3000;
const PROGRESS_EVERY = 100;
const CHECKPOINT_EVERY = 300;

const CATALOG_PATH = path.join(__dirname, 'data', 'catalog-raw.json');
const OUTPUT_PATH = path.join(__dirname, 'data', 'card-details-raw.json');
const BUILT_PATH = path.join(__dirname, 'data', 'cards.json'); // last build-data.js output, read only by --missing

// Japanese <th> label -> output field. Anything not listed is ignored.
const STAT_LABELS = {
  'カード種別': 'kind',
  'グレード': 'grade',
  '国家': 'nation',
  'クラン': 'clan',
  '種族': 'race',
  'スキル': 'skill',
  'パワー': 'power',
  'シールド': 'shield',
  'クリティカル': 'critical',
  'トリガー': 'trigger',
};
const TEXT_LABELS = {
  '効果': 'effect',
  'フレーバー': 'flavor',
};
const NUMERIC_FIELDS = new Set(['grade', 'power', 'shield', 'critical']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null;
  const setsIdx = args.indexOf('--sets');
  const sets = setsIdx !== -1 ? args[setsIdx + 1].split(',').map((s) => s.trim().toLowerCase()) : null;
  return { limit, sets, force: args.includes('--force'), missing: args.includes('--missing') };
}

/**
 * What a checkpoint entry says about whether fetching its card again could
 * help (used by --missing):
 *   'done'   it has effect text
 *   'absent' no entry at all -- never fetched
 *   'blank'  yuyu-tei hadn't filled the page in when it was fetched (a unit
 *            with no power, or an order with no text) -- worth retrying
 *   'none'   a filled page that has no 効果 on purpose: a gift marker /
 *            token / other non-card (Gift Markers and "その他" carry no
 *            rules text), or a unit with a power but no text (a vanilla
 *            unit). Refetching only gets "-" again.
 * Not exact: some pages are half-filled (a unit with grade and nation but no
 * power or text, e.g. the whole of DZ-TB03 and VSS09 when this was written),
 * which reads as 'blank' and keeps being retried until yuyu-tei fills them in
 * -- cheap, since --missing never touches the thousands of 'none' ones.
 */
function classifyEntry(entry) {
  if (!entry) return 'absent';
  if (entry.effect) return 'done';
  const kind = entry.kind || '';
  if (kind.includes('マーカー') || kind === 'その他') return 'none';
  if (kind.includes('ユニット') && entry.power != null) return 'none';
  return 'blank';
}

function clean(s) {
  const t = (s || '').replace(/ /g, ' ').trim();
  return t === '' || t === '-' ? null : t;
}

/** Cell text with <br> preserved as newlines, so multi-ability text keeps its line breaks. */
function cellText($, td) {
  const html = $(td).html() || '';
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n');
  return clean(cheerio.load(`<div>${withBreaks}</div>`)('div').text().replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n'));
}

/**
 * @returns {{effect: ?string, flavor: ?string, kind: ?string, grade: ?number, ...} | null}
 *   null only if the page had no attribute table at all (i.e. not a card page).
 */
function extractDetail($) {
  const out = {};
  let sawTable = false;

  const rows = $('table tr').toArray();
  for (let i = 0; i < rows.length; i++) {
    const $tr = $(rows[i]);
    const ths = $tr.find('th').toArray();
    const tds = $tr.find('td').toArray();
    if (ths.length === 0 && tds.length === 0) continue;
    sawTable = true;

    // Lone label row for a long-text field: value is the next row's first <td>.
    if (ths.length === 1 && tds.length === 0) {
      const label = clean($(ths[0]).text());
      const field = label && TEXT_LABELS[label];
      if (field && out[field] == null) {
        const nextTd = $(rows[i + 1]).find('td').first();
        if (nextTd.length) out[field] = cellText($, nextTd);
      }
      continue;
    }

    // Paired stat cells: th[k] labels td[k].
    for (let k = 0; k < ths.length && k < tds.length; k++) {
      const label = clean($(ths[k]).text());
      const field = label && STAT_LABELS[label];
      if (!field || out[field] != null) continue;
      let value = clean($(tds[k]).text().replace(/\s+/g, ' '));
      if (value != null && NUMERIC_FIELDS.has(field)) {
        const n = parseInt(value.replace(/[^\d-]/g, ''), 10);
        value = Number.isFinite(n) ? n : null;
      }
      if (value != null) out[field] = value;
    }
  }

  return sawTable ? out : null;
}

// Shared across workers: when set, everyone waits until this timestamp
// before their next request.
let cooldownUntil = 0;
let cooldowns = 0;

const MAX_RATE_LIMIT_PAUSES = 6; // 20s,40s,80s,160s,300s,300s ≈ 15 min max per card

async function fetchWithRetry(url, jar) {
  let attempt = 0; // network/5xx failures
  let limited = 0; // 429/403 responses (don't burn the retry budget)
  for (;;) {
    try {
      const wait = cooldownUntil - Date.now();
      if (wait > 0) await sleep(wait);
      const res = await browserGet(url, jar, SITE_ROOT); // throws "HTTP <status>" on non-2xx
      return await res.text();
    } catch (err) {
      if (/HTTP (429|403)/.test(err.message)) {
        // Global pause shared by every worker. Doubles on each consecutive
        // limited attempt (capped at 5 min) so a sustained block -- yuyu-tei
        // bans for minutes after a burst -- backs off instead of hammering.
        if (++limited > MAX_RATE_LIMIT_PAUSES) {
          console.warn(`[warn] ${url}: still rate-limited after ${MAX_RATE_LIMIT_PAUSES} pauses. Skipping for this run.`);
          return null;
        }
        const pause = Math.min(COOLDOWN_MS * Math.pow(2, limited - 1), 5 * 60 * 1000);
        if (Date.now() >= cooldownUntil) {
          cooldowns++;
          console.warn(`[rate-limit] ${err.message} -- pausing all workers ${Math.round(pause / 1000)}s (cooldown #${cooldowns})`);
        }
        cooldownUntil = Math.max(cooldownUntil, Date.now() + pause);
        continue;
      }
      if (attempt++ >= MAX_RETRIES) {
        console.warn(`[warn] ${url}: failed after ${MAX_RETRIES + 1} attempts (${err.message}). Skipping.`);
        return null;
      }
      await sleep(RETRY_BACKOFF_MS * attempt);
    }
  }
}

// Always loaded, --force or not: this run's results are merged into it, so
// a scoped run (--sets/--limit) can never drop the cards outside its scope.
function loadCheckpoint() {
  if (!fs.existsSync(OUTPUT_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')).skills || {};
  } catch (err) {
    console.error(
      `Could not read ${OUTPUT_PATH} (${err.message}) -- refusing to start over, since the first checkpoint ` +
      'would overwrite it. Restore it (it is committed: git checkout -- pipeline/data/card-details-raw.json) ' +
      'or delete it to deliberately start from scratch.'
    );
    process.exit(1);
  }
}

/**
 * Group keys whose listings already have English skill text in the last
 * build (data/cards.json). Without a readable cards.json nothing counts as
 * covered, so --missing still works, just fetching a bit more.
 */
function loadEnglishCoveredGroups(listings) {
  const covered = new Set();
  let built;
  try {
    built = JSON.parse(fs.readFileSync(BUILT_PATH, 'utf8')).cards;
  } catch (err) {
    console.warn(`[warn] No usable ${BUILT_PATH} (${err.message}); --missing won't skip cards that already have English text.`);
    return covered;
  }
  const withEnglish = new Set(built.filter((c) => c.skillTextEn).map((c) => c.id));
  for (const c of listings) {
    if (withEnglish.has(`${c.setSlug}/${c.id}`)) covered.add(groupKey(c));
  }
  return covered;
}

function writeOutput(skills) {
  writeFileAtomic(
    OUTPUT_PATH,
    JSON.stringify({ scrapedAt: new Date().toISOString(), count: Object.keys(skills).length, skills })
  );
}

async function main() {
  const { limit, sets, force, missing } = parseArgs();
  // --force means "refetch everything in scope", --missing "only what could
  // still be filled in": contradictory, so refuse rather than guess (before
  // this check --missing silently won).
  if (force && missing) {
    console.error('--force and --missing can\'t be combined: --force refetches every card in scope, --missing only the ones a fetch could fill in. Pick one.');
    process.exit(1);
  }

  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${CATALOG_PATH} (${err.message}). Run scrape-catalog.js first.`);
    process.exit(1);
  }

  // --sets scopes the whole run to listings from those setSlugs only --
  // e.g. to backfill just-added sets without touching the full queue.
  const scopedListings = sets
    ? catalog.cards.filter((c) => sets.includes((c.setSlug || '').toLowerCase()))
    : catalog.cards;
  if (sets && scopedListings.length === 0) {
    console.error(`No listings found for --sets ${sets.join(',')} -- check the slugs are right.`);
    process.exit(1);
  }

  const skills = loadCheckpoint();
  const startedWith = Object.keys(skills).length;

  // A card is "done" once it has an effect text. Cards with an attribute
  // table but no effect (typically a set yuyu-tei hasn't filled in yet) are
  // stored so their stats are usable, but are retried on the next run in
  // case the text has since appeared.
  // One representative listing per card group, preferring the plain
  // (non-variant) printing. Catalog order is newest-set-first, so the
  // cards people are most likely to look at get their text earliest.
  const reps = new Map();
  for (const c of scopedListings) {
    const k = groupKey(c);
    const cur = reps.get(k);
    if (!cur || (!isPlainPrinting(cur) && isPlainPrinting(c))) reps.set(k, c);
  }
  // --missing narrows the queue to cards a fetch could actually fill in:
  // never fetched, or fetched while yuyu-tei's page was still blank (see
  // classifyEntry) -- skipping the filled pages that have no text on purpose
  // (markers, tokens, vanilla units) and the cards that already have English
  // text in the last build (the Japanese text is only their fallback).
  const englishCovered = missing ? loadEnglishCoveredGroups(scopedListings) : new Set();
  let queue = Array.from(reps.values()).filter((c) => {
    const prev = skills[groupKey(c)];
    if (missing) {
      return ['absent', 'blank'].includes(classifyEntry(prev)) && !englishCovered.has(groupKey(c));
    }
    if (force) return true;
    return !(prev && prev.effect);
  });
  if (limit) queue = queue.slice(0, limit);

  console.log(
    `${queue.length} cards to fetch (${reps.size} unique cards across ${scopedListings.length} listings` +
    `${sets ? ` in {${sets.join(', ')}}` : ''}; ${startedWith} already in checkpoint).`
  );

  const jar = createCookieJar();
  try {
    await browserGet(SITE_ROOT, jar);
  } catch (err) {
    console.warn(`[warn] Warm-up request failed (${err.message}). Continuing anyway.`);
  }

  let fetched = 0, hits = 0, statsOnly = 0, empty = 0, failures = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length) {
      const card = queue[cursor++];
      const key = groupKey(card);
      if (!card.detailUrl) continue;

      await sleep(DELAY_MS);
      const html = await fetchWithRetry(card.detailUrl, jar);
      fetched++;

      if (html === null) {
        failures++; // left unset so a future run retries it
      } else {
        const detail = extractDetail(cheerio.load(html));
        if (!(detail && detail.effect) && skills[key]?.effect) {
          // --force refetch came back without text (a blank page, changed
          // markup): keep the text we already had rather than erase it.
          empty++;
        } else if (!detail) {
          empty++;
          skills[key] = { effect: null };
        } else {
          skills[key] = detail;
          if (detail.effect) hits++;
          else if (Object.keys(detail).length) statsOnly++;
          else empty++;
        }
      }

      if (fetched % PROGRESS_EVERY === 0) {
        console.log(`... ${fetched}/${queue.length} (${hits} with effect, ${statsOnly} stats-only, ${empty} empty, ${failures} failed)`);
      }
      if (fetched % CHECKPOINT_EVERY === 0) writeOutput(skills);
    }
  }

  await Promise.all(Array.from({ length: WORKERS }, worker));
  writeOutput(skills);

  console.log(`\nDone (${cooldowns} rate-limit cooldowns). ${fetched} fetched: ${hits} with effect text, ${statsOnly} stats-only (no text yet), ${empty} empty, ${failures} failed.`);
  console.log(`Checkpoint now holds ${Object.keys(skills).length} cards.`);

  const attempted = hits + statsOnly + empty;
  if (attempted >= 20 && hits / attempted < 0.05) {
    console.warn('\n[warn] Under 5% of pages yielded effect text -- yuyu-tei may have changed its detail-page markup. Inspect a detailUrl and update extractDetail().');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during card-detail scrape:', err);
    process.exit(1);
  });
}

module.exports = { classifyEntry, extractDetail };
