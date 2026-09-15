'use strict';

/**
 * Scrapes yuyu-tei's full VG (Cardfight!! Vanguard) single-card sell catalog
 * using the global paginated search endpoint (returns cards from every set,
 * not just one), and writes the aggregated result to data/catalog-raw.json.
 *
 * Usage:
 *   node scrape-catalog.js
 *   npm run scrape        (from inside pipeline/)
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const SEARCH_URL = 'https://yuyu-tei.jp/sell/vg/s/search';
const DELAY_MS = 400; // politeness delay between page requests
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 1000;
const MAX_PAGES = 200; // sanity ceiling so a bug can't loop forever
const PROGRESS_EVERY = 10;

const OUTPUT_PATH = path.join(__dirname, 'data', 'catalog-raw.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(page) {
  return `${SEARCH_URL}?search_word=&page=${page}`;
}

function parsePrice(text) {
  if (!text) return null;
  // Take the first contiguous run of digits, not every digit in the string
  // concatenated — a strip-and-join would silently produce a bogus number if
  // the node ever contained two separate numbers (e.g. a struck-through
  // original price next to a sale price).
  const match = text.match(/\d[\d,]*/);
  if (!match) return null;
  return parseInt(match[0].replace(/,/g, ''), 10);
}

function parseStock(text) {
  if (!text) return 0;
  if (/×|品切れ|売り切れ/.test(text)) return 0;
  const match = text.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function extractIdFromUrl(url) {
  if (!url) return null;
  const clean = url.replace(/\.jpg.*$/, '').replace(/[?#].*$/, '');
  const parts = clean.split('/').filter(Boolean);
  return parts[parts.length - 1] || null;
}

/**
 * Derive the set slug: the path segment right before the numeric id, e.g.
 * https://yuyu-tei.jp/sell/vg/card/dzbt16/10240        -> dzbt16
 * https://card.yuyu-tei.jp/vg/100_140/dzbt16/10240.jpg  -> dzbt16
 */
function extractSetSlugFromUrl(url) {
  if (!url) return null;
  const clean = url.replace(/\.jpg.*$/, '').replace(/[?#].*$/, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return parts[parts.length - 2] || null;
}

/**
 * Fetch a single search page with retries. Returns the HTML text, or null
 * if all attempts failed.
 */
async function fetchPageWithRetry(page) {
  const url = buildUrl(page);
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    } catch (err) {
      const isLastAttempt = attempt === MAX_RETRIES;
      if (isLastAttempt) {
        console.warn(
          `[warn] page ${page}: failed after ${MAX_RETRIES + 1} attempts (${err.message}). Skipping.`
        );
        return null;
      }
      console.warn(
        `[warn] page ${page}: attempt ${attempt + 1} failed (${err.message}). Retrying...`
      );
      await sleep(RETRY_BACKOFF_MS * (attempt + 1));
    }
  }
  return null;
}

/**
 * Parse one page's HTML into an array of card records.
 */
function parseCardsFromHtml(html) {
  const $ = cheerio.load(html);
  const cards = [];

  $('div.card-product').each((_, el) => {
    const $card = $(el);

    const img = $card.find('img.card').first();
    const imageUrl = img.attr('src') || '';
    const alt = img.attr('alt') || '';
    const altParts = alt.trim().split(/\s+/);
    const rarity = altParts.length > 1 ? altParts[1] : '';

    const detailLink = $card.find('a[href*="/sell/vg/card/"]').first().attr('href') || '';
    const id = extractIdFromUrl(detailLink) || extractIdFromUrl(imageUrl);
    const setSlug = extractSetSlugFromUrl(detailLink) || extractSetSlugFromUrl(imageUrl);

    const setCode = $card.find('span.border.border-dark').first().text().trim();
    const nameJp = $card.find('h4.text-primary.fw-bold').first().text().trim();

    const priceText = $card.find('strong').first().text().trim();
    const price = parsePrice(priceText);
    const priceDisplay = price !== null ? `¥${price.toLocaleString('en-US')}` : priceText || null;

    const stockText = $card.find('label.cart_sell_zaiko').first().text().trim();
    const stock = parseStock(stockText);

    if (!id) return; // skip anything we can't identify

    cards.push({
      id,
      setCode,
      setSlug,
      rarity,
      nameJp,
      price,
      priceDisplay,
      stock,
      imageUrl,
      detailUrl: detailLink,
    });
  });

  return cards;
}

async function scrapeCatalog() {
  const seen = new Set(); // `${setSlug}::${id}`
  const cards = [];
  let duplicatesSkipped = 0;
  let pagesScraped = 0;
  let consecutiveEmptyPages = 0;
  // A single 0-card page could be a transient hiccup (temporary block page,
  // odd render) rather than the true end of the catalog. Require 2 in a row
  // before concluding we're done, so one flaky page can't silently truncate
  // an otherwise-complete crawl.
  const EMPTY_PAGES_TO_CONFIRM_END = 2;

  console.log('Starting full VG catalog crawl...');

  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchPageWithRetry(page);

    if (html === null) {
      // Failed after retries; move on to the next page rather than aborting.
      pagesScraped++;
      await sleep(DELAY_MS);
      continue;
    }

    const pageCards = parseCardsFromHtml(html);

    if (pageCards.length === 0) {
      consecutiveEmptyPages++;
      console.log(
        `Page ${page} returned 0 cards (${consecutiveEmptyPages}/${EMPTY_PAGES_TO_CONFIRM_END} consecutive).`
      );
      if (consecutiveEmptyPages >= EMPTY_PAGES_TO_CONFIRM_END) {
        console.log('Confirmed end of catalog. Stopping.');
        break;
      }
      pagesScraped++;
      await sleep(DELAY_MS);
      continue;
    }
    consecutiveEmptyPages = 0;

    pagesScraped++;

    for (const card of pageCards) {
      const key = `${card.setSlug}::${card.id}`;
      if (seen.has(key)) {
        duplicatesSkipped++;
        continue;
      }
      seen.add(key);
      cards.push(card);
    }

    if (page % PROGRESS_EVERY === 0) {
      console.log(`[progress] page ${page} scraped, ${cards.length} cards collected so far...`);
    }

    await sleep(DELAY_MS);
  }

  if (duplicatesSkipped > 0) {
    console.log(`Skipped ${duplicatesSkipped} duplicate card(s) (same setSlug+id seen twice).`);
  }

  return { cards, pagesScraped };
}

async function main() {
  const startedAt = Date.now();
  const { cards, pagesScraped } = await scrapeCatalog();

  const output = {
    scrapedAt: new Date().toISOString(),
    pagesScraped,
    count: cards.length,
    cards,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `Done. Scraped ${pagesScraped} pages, ${cards.length} cards, in ${elapsedSec}s. Wrote ${OUTPUT_PATH}`
  );
}

main().catch((err) => {
  console.error('Fatal error during catalog scrape:', err);
  process.exit(1);
});
