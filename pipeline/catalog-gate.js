'use strict';

/**
 * Run gate shared by record-history.js, build-data.js and
 * backfill-history.js: refuse to record or publish a catalog that's empty
 * or suspiciously smaller than the last good one.
 *
 * Why: refresh.log shows ten zero-card builds (three of them uploaded to
 * the live site) and a 22,235-card one (6,000 listings missing) -- the scraper
 * skips a page after 3 failed attempts, so a flaky run silently produces a
 * partial catalog. Uploaded, that shows visitors "No cards" for up to a day
 * (their client cache); recorded into the price history, it would be
 * thousands of listings that merely weren't seen. A non-zero exit makes
 * refresh-and-push.ps1 abort the whole run before anything is written or
 * uploaded.
 *
 * Why 98%: the same log has 192 good runs, every one at exactly 28,235
 * cards, and every failure was all-or-nothing (0) or ~6,000 short. One
 * skipped search page is ~576 cards (~2%), so anything below 98% of the
 * baseline means at least one page went missing.
 */

const DEFAULT_THRESHOLD = 0.98;
const OVERRIDE_ENV = 'ALLOW_CATALOG_SHRINK';

function allowShrinkFromEnv(env = process.env) {
  return env[OVERRIDE_ENV] === '1';
}

/**
 * @param {number} count  cards in the catalog about to be used
 * @param {number|null|undefined} baseline  card count of the last good run(s) (unknown -> only the zero check)
 * @param {{threshold?: number, allowShrink?: boolean}} [opts]
 * @returns {{ok: boolean, overridden: boolean, message: string|null}}  `message` explains a failure,
 *   or warns when allowShrink let a shrunken catalog through (then `overridden` is true)
 */
function checkCatalogSize(count, baseline, { threshold = DEFAULT_THRESHOLD, allowShrink = false } = {}) {
  // An empty scrape is never legitimate, override or not.
  if (!Number.isFinite(count) || count <= 0) {
    return {
      ok: false,
      overridden: false,
      message: `Catalog has ${Number.isFinite(count) ? count : 'no'} cards -- refusing to continue ` +
        '(an empty scrape is always treated as a failed run).',
    };
  }
  const hasBaseline = Number.isFinite(baseline) && baseline > 0;
  if (hasBaseline && count < baseline * threshold) {
    const minimum = Math.ceil(baseline * threshold);
    const detail = `Catalog has ${count} cards, below ${Math.round(threshold * 100)}% of the baseline ` +
      `of ${baseline} from recent good runs (minimum ${minimum})`;
    if (allowShrink) {
      return { ok: true, overridden: true, message: `${detail} -- continuing anyway because ${OVERRIDE_ENV}=1.` };
    }
    return {
      ok: false,
      overridden: false,
      message: `${detail} -- refusing to continue, this looks like a partial scrape (a skipped page is ` +
        `~2% of the catalog). If the catalog really shrank, rerun with ${OVERRIDE_ENV}=1.`,
    };
  }
  return { ok: true, overridden: false, message: null };
}

module.exports = { DEFAULT_THRESHOLD, OVERRIDE_ENV, allowShrinkFromEnv, checkCatalogSize };
