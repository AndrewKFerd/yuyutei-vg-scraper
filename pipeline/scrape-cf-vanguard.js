'use strict';

/**
 * Scrapes the official English Cardfight!! Vanguard card database
 * (https://en.cf-vanguard.com/cardlist/cardsearch/) and writes the results
 * to data/cf-vanguard-raw.json.
 *
 * ## What we learned about the site (see CF_VANGUARD_NOTES.md for the full
 * write-up):
 *
 * - There is no JSON API. The "Gallery View" search page is server-rendered
 *   for its first batch of results, then infinite-scrolls by calling
 *   `/cardlist/cardsearch_ex/?...&view=<image|text>&page=N` (N starting at 2)
 *   which returns a bare `<li>...</li>` HTML fragment to append. `view=text`
 *   ("List Detail View") returns the same fragment shape but with the card's
 *   number, name, kind/nation/grade/power/shield line, and full rules text
 *   included per card — `view=image` only gives name (as alt/title) + image.
 *   We use `view=text` throughout so we can capture nation/clan for free.
 * - The unfiltered `regulation=D` (current Standard format) listing has
 *   ~12,765 results across 532 pages of 24 cards each. Scraping that whole
 *   thing isn't worthwhile: the vast majority of those rows are one-off
 *   promo/event cards (BCS2022/VGS01EN, BRO2022/..., etc.) that have no
 *   structured Japanese counterpart worth matching against.
 * - The site's own `keyword=` search param matches against card NUMBERS as
 *   well as names/text, so `keyword=D-BT01` reliably scopes results to just
 *   that booster set's cards (verified: 213 results / max_page=9, i.e.
 *   9*24=216 >= 213, consistent with one set's worth of cards). We use this
 *   to fetch one booster set at a time instead of crawling the global list.
 * - The set-numbering families that exist in English are `D-BTxx` (the
 *   original "Will+Dress/overDress" era, sets 01 through 13 as of this
 *   scrape) and `DZ-BTxx` (the current "Divinez" era, sets 01 through 15 as
 *   of this scrape — one set behind Japan's DZ-BT16). We also grab the
 *   smaller structure/trial-deck families (D-SD, D-TD, DZ-TD) since they are
 *   still card-coded product lines (as opposed to promo/event codes), even
 *   though match-official.js does NOT currently trust those families for
 *   matching (see notes).
 *
 * Politeness / scope ceiling: we probe each family's set numbers (01, 02, ...)
 * until we hit one with 0 results, then move to the next family. We cap the
 * total number of HTTP requests (probe requests + paginated fetches combined)
 * at MAX_TOTAL_REQUESTS so a bug (or the site adding way more sets than
 * expected) can't turn this into an unbounded crawl. At the families/sizes
 * that exist today (~28 BT sets averaging ~200-300 cards, plus a handful of
 * small SD/TD sets) this finishes in a few hundred requests, comfortably
 * under the ceiling, in a few minutes at a 400ms delay between requests.
 *
 * Usage:
 *   node scrape-cf-vanguard.js
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { createCookieJar, browserGet } = require('./http-client');

const BASE = 'https://en.cf-vanguard.com';
const SEARCH_URL = `${BASE}/cardlist/cardsearch/`;
const EX_URL = `${BASE}/cardlist/cardsearch_ex/`;

const DELAY_MS = 400; // politeness delay between every HTTP request
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 1000;

// Sanity ceiling on total HTTP requests (probes + page fetches) for the
// whole run. Documented reasoning above. At ~400ms/request this bounds a
// run to roughly (MAX_TOTAL_REQUESTS * 0.4)/60 minutes worst case.
const MAX_TOTAL_REQUESTS = 700;

// Families to discover & scrape, in priority order. `pad` is how many
// digits the set number is zero-padded to in the keyword (all observed
// families use 2). `maxProbe` bounds how many set numbers we'll try before
// giving up on a family even if we haven't hit a run of misses (safety net).
const FAMILIES = [
  { prefix: 'D-BT', pad: 2, maxProbe: 40 }, // verified: matches EN 1:1 by code
  { prefix: 'DZ-BT', pad: 2, maxProbe: 40 }, // verified: matches EN 1:1 by code
  { prefix: 'D-SD', pad: 2, maxProbe: 20 }, // structure decks, not yet verified
  { prefix: 'D-TD', pad: 2, maxProbe: 20 }, // trial decks, not yet verified
  { prefix: 'DZ-TD', pad: 2, maxProbe: 20 }, // trial decks, not yet verified
];

const OUTPUT_PATH = path.join(__dirname, 'data', 'cf-vanguard-raw.json');

let requestsMade = 0;
const jar = createCookieJar();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSearchUrl(keyword) {
  const qs = new URLSearchParams({
    regulation: 'D',
    nation: '',
    clan: '',
    keyword,
    'keyword_type[0]': 'all',
    'kind[0]': 'all',
    'grade[0]': 'all',
    power_from: '',
    power_to: '',
    rare: '',
    'trigger[0]': 'all',
    view: 'text',
  });
  return `${SEARCH_URL}?${qs.toString()}`;
}

function buildExUrl(keyword, page) {
  const qs = new URLSearchParams({
    regulation: 'D',
    nation: '',
    clan: '',
    keyword,
    'keyword_type[0]': 'all',
    'kind[0]': 'all',
    'grade[0]': 'all',
    power_from: '',
    power_to: '',
    rare: '',
    'trigger[0]': 'all',
    view: 'text',
    page: String(page),
    t: String(Date.now()),
  });
  return `${EX_URL}?${qs.toString()}`;
}

async function fetchWithRetry(url) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    requestsMade++;
    try {
      const res = await browserGet(url, jar, SEARCH_URL);
      return await res.text();
    } catch (err) {
      const isLastAttempt = attempt === MAX_RETRIES;
      if (isLastAttempt) {
        console.warn(`[warn] ${url}: failed after ${MAX_RETRIES + 1} attempts (${err.message}). Skipping.`);
        return null;
      }
      console.warn(`[warn] ${url}: attempt ${attempt + 1} failed (${err.message}). Retrying...`);
      await sleep(RETRY_BACKOFF_MS * (attempt + 1));
    }
  }
  return null;
}

function resolveImageUrl(src) {
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return src;
  return `${BASE}${src.startsWith('/') ? '' : '/'}${src}`;
}

/**
 * Parse one page of `view=text` HTML (either the full search page or an
 * `_ex` ajax fragment) into card records.
 */
function parseCards(html) {
  const $ = cheerio.load(html);
  const cards = [];

  $('a[href*="cardno="]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    const match = href.match(/cardno=([^&]+)/);
    if (!match) return;
    const cfCode = decodeURIComponent(match[1]);

    const img = $a.find('img.cardimage').first();
    const nameEn = (img.attr('title') || img.attr('alt') || $a.find('h5').first().text() || '').trim();
    const imageUrl = resolveImageUrl(img.attr('src'));

    const statusText = $a.find('div.status').first().text() || '';
    // Status line looks like: "Normal Unit｜Dragon Empire｜Grade 3｜Power 13000｜Shield -"
    const statusParts = statusText
      .split('｜')
      .map((s) => s.trim())
      .filter(Boolean);
    const kind = statusParts[0] || null;
    const clan = statusParts[1] || null; // "nation" for D-series cards, old clan name for legacy cards
    const gradeMatch = statusText.match(/Grade\s*(\d+)/i);
    const grade = gradeMatch ? parseInt(gradeMatch[1], 10) : null;
    const powerMatch = statusText.match(/Power\s*(\d+)/i);
    const power = powerMatch ? parseInt(powerMatch[1], 10) : null;
    const shieldMatch = statusText.match(/Shield\s*([\d,]+)/i);
    const shield = shieldMatch ? parseInt(shieldMatch[1].replace(/,/g, ''), 10) : null;

    // The card's full ability/rules text sits in a <p> right after the
    // status line, inside the same `.text` block -- present in view=text
    // but simply never read out until now.
    const skillText = $a.find('div.text p').first().text().trim() || null;

    if (!cfCode || !nameEn) return;

    cards.push({ cfCode, nameEn, kind, clan, grade, power, shield, skillText, imageUrl });
  });

  return cards;
}

/**
 * Fetch every page for one keyword-scoped search (a single booster/structure
 * set), respecting the global request ceiling. Returns { cards, pages }.
 */
async function scrapeSet(keyword) {
  const cards = [];
  let pages = 0;

  const firstUrl = buildSearchUrl(keyword);
  const firstHtml = await fetchWithRetry(firstUrl);
  pages++;
  // null (not 0) distinguishes "the fetch itself failed after retries" from
  // a genuine 0-result search, so a transient network/HTTP failure can't be
  // mistaken for "this set doesn't exist" by the caller.
  if (firstHtml === null) return { cards, pages, totalResults: null };

  const resultsMatch = firstHtml.match(/(\d+)\s*Results/);
  const totalResults = resultsMatch ? parseInt(resultsMatch[1], 10) : 0;
  if (totalResults === 0) return { cards, pages, totalResults: 0 };

  cards.push(...parseCards(firstHtml));

  const maxPageMatch = firstHtml.match(/max_page\s*=\s*(\d+)/);
  const maxPage = maxPageMatch ? parseInt(maxPageMatch[1], 10) : 1;

  for (let page = 2; page <= maxPage; page++) {
    if (requestsMade >= MAX_TOTAL_REQUESTS) {
      console.warn(`[warn] Hit MAX_TOTAL_REQUESTS (${MAX_TOTAL_REQUESTS}) mid-set (${keyword}). Stopping this set early.`);
      break;
    }
    await sleep(DELAY_MS);
    const url = buildExUrl(keyword, page);
    const html = await fetchWithRetry(url);
    pages++;
    if (html === null) continue;
    cards.push(...parseCards(html));
  }

  return { cards, pages, totalResults };
}

async function discoverAndScrapeFamily(family) {
  const { prefix, pad, maxProbe } = family;
  const setResults = [];

  for (let n = 1; n <= maxProbe; n++) {
    if (requestsMade >= MAX_TOTAL_REQUESTS) {
      console.warn(`[warn] Hit MAX_TOTAL_REQUESTS (${MAX_TOTAL_REQUESTS}). Stopping family ${prefix} early.`);
      break;
    }
    const setNo = String(n).padStart(pad, '0');
    const keyword = `${prefix}${setNo}`;

    await sleep(DELAY_MS);
    let { cards, pages, totalResults } = await scrapeSet(keyword);

    if (totalResults === null) {
      // The probe request itself failed (not "0 results") — could be a
      // transient network hiccup, not proof this set doesn't exist. Retry
      // once more before giving up, so one bad request can't silently
      // truncate the rest of the family.
      console.warn(`[${prefix}] ${keyword}: fetch failed, retrying once before assuming end-of-family...`);
      await sleep(DELAY_MS);
      ({ cards, pages, totalResults } = await scrapeSet(keyword));
    }

    if (totalResults === null) {
      console.warn(`[${prefix}] ${keyword}: fetch failed again — stopping family ${prefix} here (data may be incomplete).`);
      break;
    }

    if (totalResults === 0) {
      console.log(`[${prefix}] ${keyword}: 0 results — stopping family (last real set was ${prefix}${String(n - 1).padStart(pad, '0')}).`);
      break;
    }

    console.log(`[${prefix}] ${keyword}: ${totalResults} results, ${cards.length} cards parsed, ${pages} page(s) fetched.`);
    setResults.push({ setKeyword: keyword, totalResults, cardCount: cards.length, cards });
  }

  return setResults;
}

async function main() {
  const startedAt = Date.now();
  const allCards = [];
  const seen = new Set();
  const familySummaries = [];

  // Visit the site root first, like a real browser would before searching --
  // also plants any session cookie the search endpoint expects echoed back.
  try {
    await browserGet(BASE, jar);
  } catch (err) {
    console.warn(`[warn] Warm-up request to ${BASE} failed (${err.message}). Continuing anyway.`);
  }
  await sleep(DELAY_MS);

  for (const family of FAMILIES) {
    if (requestsMade >= MAX_TOTAL_REQUESTS) {
      console.warn(`[warn] Request ceiling reached before starting family ${family.prefix}. Skipping remaining families.`);
      break;
    }
    const sets = await discoverAndScrapeFamily(family);
    let familyCardCount = 0;
    for (const s of sets) {
      for (const card of s.cards) {
        if (seen.has(card.cfCode)) continue;
        seen.add(card.cfCode);
        allCards.push(card);
        familyCardCount++;
      }
    }
    familySummaries.push({
      prefix: family.prefix,
      setsFound: sets.length,
      cardCount: familyCardCount,
    });
  }

  const output = {
    scrapedAt: new Date().toISOString(),
    sourceUrl: 'https://en.cf-vanguard.com/cardlist/cardsearch/',
    requestsMade,
    maxTotalRequests: MAX_TOTAL_REQUESTS,
    familySummaries,
    count: allCards.length,
    cards: allCards,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `Done. ${requestsMade} HTTP requests, ${allCards.length} unique cards, in ${elapsedSec}s. Wrote ${OUTPUT_PATH}`
  );
  console.table(familySummaries);
}

main().catch((err) => {
  console.error('Fatal error during cf-vanguard scrape:', err);
  process.exit(1);
});
