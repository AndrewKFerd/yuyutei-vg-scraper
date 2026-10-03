'use strict';

/**
 * Gates for the official-English reference data (cf-vanguard.com), shared
 * by scrape-cf-vanguard.js and build-data.js.
 *
 * Why: refresh.log shows 22 of ~306 cf-vanguard scrapes coming back partial
 * or empty (sets that failed to load, a family cut short by one failed
 * probe, the whole site down) -- and the scraper wrote them out regardless.
 * build-data.js then fell back to romaji for every card it lost, and two of
 * those builds reached the live site: Sep 24 23:08 with 14 official English
 * names instead of ~6,300, and Sep 30 20:04 with none at all.
 *
 *  1. checkReferenceScrape (scrape-cf-vanguard.js): a scrape with any
 *     incomplete set, or more than 2% smaller than the file it would
 *     replace, keeps the previous cf-vanguard-raw.json instead. Official
 *     names change rarely, so the last good scrape is a far better fallback
 *     than romaji -- and the rest of the refresh (prices, stock) still runs.
 *  2. checkOfficialRetention (build-data.js): the backstop for any other
 *     cause (a missing or corrupt cf-vanguard-raw.json, a matcher bug).
 *     Listings that had an official English name in the previous
 *     cards.json and are still in the catalog must keep it -- an official
 *     release doesn't get un-released.
 *
 * Both use 98%, like the catalog run gate, and share one override.
 */

const DEFAULT_THRESHOLD = 0.98;
const OVERRIDE_ENV = 'ALLOW_OFFICIAL_SHRINK';

function allowOfficialShrinkFromEnv(env = process.env) {
  return env[OVERRIDE_ENV] === '1';
}

const PASS = { ok: true, overridden: false, message: null };

/**
 * Whether a finished cf-vanguard scrape may replace the previous
 * cf-vanguard-raw.json.
 *
 * @param {{count: number, previousCount?: number|null, problems?: string[]}} scrape
 *   count = unique cards scraped; previousCount = the existing file's count
 *   (null/undefined when there is none); problems = why any set is
 *   incomplete (a page that failed, fewer cards parsed than the site
 *   reported, a family cut short, the request ceiling)
 * @param {{threshold?: number, allowShrink?: boolean}} [opts]
 * @returns {{ok: boolean, overridden: boolean, message: string|null}}  ok=false means
 *   keep the previous file; `message` explains a refusal, or warns about an override
 *   or about an incomplete scrape written only because there was nothing to keep
 */
function checkReferenceScrape({ count, previousCount, problems = [] }, {
  threshold = DEFAULT_THRESHOLD,
  allowShrink = false,
} = {}) {
  const hasPrevious = Number.isFinite(previousCount) && previousCount > 0;
  const reasons = [...problems];
  if (hasPrevious && !(count >= previousCount * threshold)) {
    reasons.push(
      `${count} cards is below ${Math.round(threshold * 100)}% of the previous scrape's ${previousCount} ` +
      `(minimum ${Math.ceil(previousCount * threshold)})`
    );
  }
  if (reasons.length === 0) return PASS;

  const detail = `cf-vanguard scrape looks incomplete: ${reasons.join('; ')}`;
  if (!hasPrevious) {
    // Nothing better to keep -- a partial reference beats none.
    return { ok: true, overridden: false, message: `${detail} -- writing it anyway, there is no previous scrape to keep.` };
  }
  if (allowShrink) {
    return { ok: true, overridden: true, message: `${detail} -- writing it anyway because ${OVERRIDE_ENV}=1.` };
  }
  return {
    ok: false,
    overridden: false,
    message: `${detail} -- keeping the previous cf-vanguard-raw.json (${previousCount} cards) rather than ` +
      `dropping official English names from the site. If the site really lost cards, rerun with ${OVERRIDE_ENV}=1.`,
  };
}

/**
 * Whether a build may ship: of the listings that had an official English
 * name in the previous cards.json and are still in the catalog, at least
 * 98% must still have one.
 *
 * @param {number} kept      of those listings, how many are still official in this build
 * @param {number} previous  how many listings were official last build and are still in the catalog
 * @param {{threshold?: number, allowShrink?: boolean}} [opts]
 * @returns {{ok: boolean, overridden: boolean, message: string|null}}
 */
function checkOfficialRetention(kept, previous, { threshold = DEFAULT_THRESHOLD, allowShrink = false } = {}) {
  if (!Number.isFinite(previous) || previous <= 0) return PASS;
  if (kept >= previous * threshold) return PASS;

  const detail = `Only ${kept} of the ${previous} listings that had an official English name in the previous ` +
    `cards.json still have one (below ${Math.round(threshold * 100)}%)`;
  if (allowShrink) {
    return { ok: true, overridden: true, message: `${detail} -- building anyway because ${OVERRIDE_ENV}=1.` };
  }
  return {
    ok: false,
    overridden: false,
    message: `${detail} -- data/cf-vanguard-raw.json is probably missing or incomplete; rerun ` +
      `scrape-cf-vanguard.js. If those names really were withdrawn, rerun with ${OVERRIDE_ENV}=1.`,
  };
}

module.exports = {
  DEFAULT_THRESHOLD,
  OVERRIDE_ENV,
  allowOfficialShrinkFromEnv,
  checkReferenceScrape,
  checkOfficialRetention,
};
