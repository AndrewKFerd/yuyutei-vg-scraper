'use strict';

/**
 * Scrapes yuyu-tei's per-set listing page for exactly one set and merges the
 * result into the existing pipeline/data/catalog-raw.json -- for updating a
 * single newly-released set (e.g. a just-added DZSS19) without re-crawling
 * the entire ~28k-card global catalog.
 *
 * The per-set page (https://yuyu-tei.jp/sell/vg/s/<slug>) uses the exact
 * same card-product/cards-list markup as the global search endpoint
 * scrape-catalog.js already parses (verified against a live page,
 * 2026-09), and returns the whole set on one page -- no pagination to
 * handle. Card shape, id/setSlug derivation etc. are all identical, so
 * this reuses parseCardsFromHtml from scrape-catalog.js rather than
 * duplicating it.
 *
 * "Merge" here means: every card in catalog-raw.json whose setSlug matches
 * is dropped and replaced with what this scrape just found -- so a card
 * pulled from sale disappears and a price/stock change is picked up, same
 * as a full recrawl would do for that set.
 *
 * Usage:
 *   node scrape-set.js <slug>     e.g. node scrape-set.js dzss19
 */

const fs = require('fs');
const path = require('path');
const { createCookieJar, browserGet } = require('./http-client');
const { parseCardsFromHtml } = require('./scrape-catalog');

const SITE_ROOT = 'https://yuyu-tei.jp/';
const CATALOG_PATH = path.join(__dirname, 'data', 'catalog-raw.json');

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node scrape-set.js <slug>   e.g. node scrape-set.js dzss19');
    process.exit(1);
  }

  const url = `${SITE_ROOT}sell/vg/s/${slug}`;
  const jar = createCookieJar();
  try {
    await browserGet(SITE_ROOT, jar);
  } catch (err) {
    console.warn(`[warn] Warm-up request failed (${err.message}). Continuing anyway.`);
  }

  console.log(`Fetching ${url} ...`);
  const res = await browserGet(url, jar, SITE_ROOT);
  const html = await res.text();

  const scraped = parseCardsFromHtml(html);
  if (scraped.length === 0) {
    console.error(`No cards found for slug "${slug}" -- check the slug is right and the set is actually listed.`);
    process.exit(1);
  }

  // Sanity check: every parsed card should actually belong to this slug
  // (parseCardsFromHtml derives setSlug from each card's own detail/image
  // URL, so a markup change elsewhere on the page can't silently mix in
  // cards from a different set).
  const wrongSlug = scraped.filter((c) => c.setSlug !== slug);
  if (wrongSlug.length > 0) {
    console.error(
      `${wrongSlug.length} parsed card(s) resolved to a different setSlug than "${slug}" ` +
      `(e.g. "${wrongSlug[0].setSlug}") -- aborting rather than merging possibly-wrong data.`
    );
    process.exit(1);
  }

  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${CATALOG_PATH} (${err.message}). Run scrape-catalog.js first.`);
    process.exit(1);
  }

  const before = catalog.cards.filter((c) => c.setSlug === slug).length;
  catalog.cards = catalog.cards.filter((c) => c.setSlug !== slug).concat(scraped);
  catalog.count = catalog.cards.length;
  catalog.scrapedAt = new Date().toISOString();

  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');

  console.log(
    `"${slug}": ${before} card(s) previously in catalog-raw.json, ${scraped.length} scraped just now. ` +
    `Wrote ${CATALOG_PATH} (${catalog.count} cards total).`
  );
  console.log('Run build-data.js next to fold this into data/cards.json.');
}

main().catch((err) => {
  console.error('Fatal error during single-set scrape:', err);
  process.exit(1);
});
