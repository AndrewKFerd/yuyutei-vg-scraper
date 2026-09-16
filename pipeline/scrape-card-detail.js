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
 * One request per card (~28k). Runs WORKERS concurrent fetchers, each
 * pacing itself by DELAY_MS, and checkpoints to disk every CHECKPOINT_EVERY
 * cards. A re-run skips cards already fetched (hit or confirmed-empty), so
 * an interrupted run resumes. --force refetches everything.
 *
 * Usage:
 *   node scrape-card-detail.js             # full run (resumable)
 *   node scrape-card-detail.js --limit 20  # smoke test
 *   node scrape-card-detail.js --force     # ignore checkpoint
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { createCookieJar, browserGet } = require('./http-client');

const SITE_ROOT = 'https://yuyu-tei.jp/';

// yuyu-tei starts answering HTTP 429 somewhere above ~5 req/s sustained
// (measured: 3 workers @ 350ms tripped it within a minute). Two workers at
// 650ms is ~3 req/s. On any 429 every worker also backs off for COOLDOWN_MS
// before continuing, so a burst self-corrects instead of burning retries.
const WORKERS = 2;
const DELAY_MS = 650;
const COOLDOWN_MS = 20000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 3000;
const PROGRESS_EVERY = 100;
const CHECKPOINT_EVERY = 300;

const CATALOG_PATH = path.join(__dirname, 'data', 'catalog-raw.json');
const OUTPUT_PATH = path.join(__dirname, 'data', 'card-skills-raw.json');

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
  return { limit, force: args.includes('--force') };
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

function loadCheckpoint(force) {
  if (force || !fs.existsSync(OUTPUT_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')).skills || {};
  } catch (err) {
    console.warn(`[warn] Could not read ${OUTPUT_PATH} (${err.message}). Starting fresh.`);
    return {};
  }
}

function writeOutput(skills) {
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ scrapedAt: new Date().toISOString(), count: Object.keys(skills).length, skills }),
    'utf8'
  );
}

async function main() {
  const { limit, force } = parseArgs();

  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${CATALOG_PATH} (${err.message}). Run scrape-catalog.js first.`);
    process.exit(1);
  }

  const skills = loadCheckpoint(force);
  const startedWith = Object.keys(skills).length;

  // A card is "done" once it has an effect text. Cards with an attribute
  // table but no effect (typically a set yuyu-tei hasn't filled in yet) are
  // stored so their stats are usable, but are retried on the next run in
  // case the text has since appeared.
  let queue = (limit ? catalog.cards.slice(0, limit) : catalog.cards).filter((c) => {
    const prev = skills[`${c.setSlug}/${c.id}`];
    return !(prev && prev.effect);
  });

  console.log(`${queue.length} cards to fetch (${startedWith} already in checkpoint).`);

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
      const key = `${card.setSlug}/${card.id}`;
      if (!card.detailUrl) continue;

      await sleep(DELAY_MS);
      const html = await fetchWithRetry(card.detailUrl, jar);
      fetched++;

      if (html === null) {
        failures++; // left unset so a future run retries it
      } else {
        const detail = extractDetail(cheerio.load(html));
        if (!detail) {
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

main().catch((err) => {
  console.error('Fatal error during card-detail scrape:', err);
  process.exit(1);
});
