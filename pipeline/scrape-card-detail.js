'use strict';

/**
 * Fetches every card's own yuyu-tei detail page (the `detailUrl` already
 * collected by scrape-catalog.js) to pull its Japanese skill/ability text --
 * something the global search-results listing does not include at all, only
 * a card's name/price/stock.
 *
 * ## Unverified selectors -- read before running
 *
 * This is a best-effort scraper. The CSS selectors and heading-text heuristic
 * below were written from the class-naming conventions yuyu-tei uses
 * elsewhere (scrape-catalog.js, and the older backend/scraper.js in git
 * history) since the detail-page markup itself could not be inspected: this
 * machine's network policy (a FortiGuard web filter, category "Games")
 * blocks yuyu-tei.jp outright. Separately, yuyu-tei's own bot defenses have
 * also been observed hard-blocking (HTTP 403) requests from GitHub Actions'
 * runner IPs after the first couple of requests -- see http-client.js for
 * the browser-header/cookie-jar mitigation shared with the other scrapers.
 * That mitigation is unverified for this specific script too, for the same
 * reason: no request to yuyu-tei.jp has ever succeeded from a machine this
 * was written on.
 *
 * Before a full run, smoke-test on a handful of cards from a network that
 * can actually reach yuyu-tei.jp:
 *
 *   node scrape-card-detail.js --limit 20
 *
 * and check the printed hit rate. A rate near 0% means the selectors need to
 * be corrected against the real markup (open one `detailUrl` in a browser
 * and see what wraps the ability text) before trusting a full run.
 *
 * ## Scope and runtime
 *
 * One HTTP request per card (~28k), vs. ~47 for the whole catalog listing --
 * at the same 400ms politeness delay used elsewhere in this pipeline, a full
 * run takes multiple hours. Progress is checkpointed to disk every
 * CHECKPOINT_EVERY cards, and already-fetched cards (hit, or a confirmed
 * miss) are skipped on a re-run, so an interrupted run resumes instead of
 * starting over. Pass --force to ignore the checkpoint and refetch
 * everything.
 *
 * Usage:
 *   node scrape-card-detail.js             # full run (resumable)
 *   node scrape-card-detail.js --limit 20  # smoke test a handful of cards
 *   node scrape-card-detail.js --force     # ignore checkpoint, refetch all
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { createCookieJar, browserGet } = require('./http-client');

const SITE_ROOT = 'https://yuyu-tei.jp/';

const DELAY_MS = 400;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 1000;
const PROGRESS_EVERY = 25;
const CHECKPOINT_EVERY = 200;

const CATALOG_PATH = path.join(__dirname, 'data', 'catalog-raw.json');
const OUTPUT_PATH = path.join(__dirname, 'data', 'card-skills-raw.json');

// Ordered best-guess selectors for a detail page's ability-text block,
// tried most-specific-first. UNVERIFIED -- see file header.
const SKILL_SELECTOR_CANDIDATES = [
  '.card-skill-text',
  '.skill-text',
  '.card-effect',
  '.effect-text',
  '.card-detail-text',
  '.card-text',
  'div.text-skill',
];

// Fallback for a label/value layout ("テキスト" or "効果" as its own
// heading element, with the actual ability text in the very next element) --
// a common pattern on Japanese TCG/e-commerce sites when no dedicated class
// exists for the value itself.
const HEADING_LABELS = new Set(['テキスト', '効果', 'スキル']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null;
  const force = args.includes('--force');
  return { limit, force };
}

async function fetchWithRetry(url, jar) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await browserGet(url, jar, SITE_ROOT);
      return await res.text();
    } catch (err) {
      const isLastAttempt = attempt === MAX_RETRIES;
      if (isLastAttempt) {
        console.warn(`[warn] ${url}: failed after ${MAX_RETRIES + 1} attempts (${err.message}). Skipping.`);
        return null;
      }
      await sleep(RETRY_BACKOFF_MS * (attempt + 1));
    }
  }
  return null;
}

/** @returns {{ text: string, matchedSelector: string } | null} */
function extractSkillTextJp($) {
  for (const selector of SKILL_SELECTOR_CANDIDATES) {
    const text = $(selector).first().text().trim();
    if (text) return { text, matchedSelector: selector };
  }

  let found = null;
  $('h1, h2, h3, h4, h5, dt, th, span, div').each((_, el) => {
    if (found) return false;
    const $el = $(el);
    // Own text only (excluding nested children) so a wrapping container
    // whose full text happens to contain "テキスト" doesn't false-match.
    const label = $el.clone().children().remove().end().text().trim();
    if (!HEADING_LABELS.has(label)) return;
    const next = $el.next();
    const text = next.text().trim();
    if (text) {
      found = { text, matchedSelector: `heuristic:${label}` };
      return false;
    }
  });
  return found;
}

function loadCheckpoint(force) {
  if (force || !fs.existsSync(OUTPUT_PATH)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
    return raw.skills || {};
  } catch (err) {
    console.warn(`[warn] Could not read existing ${OUTPUT_PATH} (${err.message}). Starting fresh.`);
    return {};
  }
}

function writeOutput(skills) {
  const payload = {
    scrapedAt: new Date().toISOString(),
    count: Object.keys(skills).length,
    skills,
  };
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload), 'utf8');
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

  let cardsToProcess = catalog.cards;
  if (limit) cardsToProcess = cardsToProcess.slice(0, limit);

  const skills = loadCheckpoint(force);
  const startedWith = Object.keys(skills).length;

  const jar = createCookieJar();
  try {
    await browserGet(SITE_ROOT, jar);
  } catch (err) {
    console.warn(`[warn] Warm-up request to ${SITE_ROOT} failed (${err.message}). Continuing anyway.`);
  }
  await sleep(DELAY_MS);

  let fetched = 0;
  let hits = 0;
  let misses = 0;
  let failures = 0;
  const selectorTally = {};

  for (const card of cardsToProcess) {
    const key = `${card.setSlug}/${card.id}`;
    if (Object.prototype.hasOwnProperty.call(skills, key)) continue; // resumed from checkpoint
    if (!card.detailUrl) {
      skills[key] = null;
      continue;
    }

    await sleep(DELAY_MS);
    const html = await fetchWithRetry(card.detailUrl, jar);
    fetched++;

    if (html === null) {
      failures++;
      continue; // leave unset so a future run retries this one
    }

    const $ = cheerio.load(html);
    const result = extractSkillTextJp($);
    if (result) {
      skills[key] = result.text;
      hits++;
      selectorTally[result.matchedSelector] = (selectorTally[result.matchedSelector] || 0) + 1;
    } else {
      skills[key] = null;
      misses++;
    }

    if (fetched % PROGRESS_EVERY === 0) {
      console.log(`... ${fetched}/${cardsToProcess.length - startedWith} fetched this run (${hits} hit, ${misses} miss, ${failures} failed)`);
    }
    if (fetched % CHECKPOINT_EVERY === 0) {
      writeOutput(skills);
    }
  }

  writeOutput(skills);

  console.log(`\nDone. ${fetched} fetched this run, ${hits} hit, ${misses} miss, ${failures} failed.`);
  console.log(`Total in checkpoint: ${Object.keys(skills).length} cards.`);
  console.log('Selector hit tally:', selectorTally);

  const attempted = hits + misses;
  const hitRate = attempted > 0 ? hits / attempted : 0;
  if (attempted >= 20 && hitRate < 0.05) {
    console.warn(
      '\n[warn] Hit rate is under 5% -- the selectors in SKILL_SELECTOR_CANDIDATES / ' +
      'HEADING_LABELS almost certainly do not match this site\'s real detail-page markup. ' +
      'Inspect a detailUrl in a browser and update scrape-card-detail.js before trusting this data.'
    );
  }
}

main().catch((err) => {
  console.error('Fatal error during card-detail scrape:', err);
  process.exit(1);
});
