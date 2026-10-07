'use strict';

/**
 * Scrapes fan-translated English names and card text for D-era (D-/DZ-),
 * V-era (V-), G-era (G-) and older (unprefixed: BT, EB, TD, PR...) cards from
 * the Cardfight!! Vanguard Fandom wiki (https://cardfight.fandom.com), for the
 * many cards cf-vanguard.com has no official English release of yet (whole
 * current sets, promos, structure decks, most of the V/G eras...). Writes
 * data/fandom-raw.json, which match-fandom.js indexes for build-data.js.
 *
 * Options:
 *   --series D,DZ,V,G,OLD   which series to keep (default: all). Series are
 *                           read off the card-code prefix, see fandom-series.js.
 *                           Without D/DZ the {{DTable}} listing isn't walked.
 *                           A subset is MERGED into the existing output file:
 *                           pages of the other series stay, only the selected
 *                           series are replaced (mergeScrapes).
 *   --limit <n>             stop after n listing batches (50 pages each) per
 *                           template -- for trying a change out. Requires --out
 *                           so a partial scrape can't replace the real file.
 *   --out <path>            write here instead of data/fandom-raw.json
 *
 * Uses the MediaWiki API rather than scraping HTML: D-era card pages use
 * {{DTable}}, so a `generator=embeddedin` listing returns every card page's
 * wikitext, 50 at a time. Every older era uses {{CardTable}} (as do older
 * cards reprinted in D-/DZ- sets: D-VS, D-PV...), so that listing is walked
 * too, keeping only pages that list a printing in a selected series -- the
 * V/G/older cards are just a wider filter on pages the walk fetches anyway,
 * so they add no listing requests. Effect text leans on
 * wiki templates ({{Once}}, {{Cost|...}}, {{FV|D}}, {{DivineSkill|...}});
 * rather than re-implementing them, each batch's effects are sent back
 * through `action=expandtemplates` in one request and the expanded wikitext
 * is flattened to plain text.
 *
 * Wiki text is licensed CC BY-SA 3.0 -- the frontend credits and links each
 * card's source page wherever this text is shown.
 *
 * Not part of the recurring refresh (refresh-and-push.ps1): wiki text
 * changes slowly, so run this by hand occasionally, then build-data.js.
 */

const fs = require('fs');
const path = require('path');
const { fetchWithTimeout } = require('./http-client');
const { writeFileAtomic } = require('./fs-atomic');
const {
  ALL_SERIES, CARD_CODE_RE, FOREIGN_CODE_RE, seriesOfCode, familyOfSeries, parseSeries, LEGACY_SERIES,
} = require('./fandom-series');

const API_URL = 'https://cardfight.fandom.com/api.php';
const OUTPUT_PATH = path.join(__dirname, 'data', 'fandom-raw.json');
// MediaWiki etiquette: identify the client instead of posing as a browser.
const USER_AGENT = 'yuyutei-vg-scraper/1.0 (https://github.com/AndrewKFerd/yuyutei-vg-scraper)';
const DELAY_MS = 500;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 2000;
const MAX_REQUESTS = 2000; // listing batches + one expansion per batch; headroom for retries
const EXPAND_SEPARATOR = '\n@@CARD-SEPARATOR@@\n';

// Card-page templates to walk, and the series every page using it is known
// to belong to (null: any -- decided per page from its printings).
const TEMPLATES = [
  { title: 'Template:DTable', series: ['D', 'DZ'] },
  { title: 'Template:CardTable', series: null },
];

let requestsMade = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiRequest(params, { post = false } = {}) {
  const body = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  for (let attempt = 0; ; attempt++) {
    if (++requestsMade > MAX_REQUESTS) throw new Error(`Request ceiling (${MAX_REQUESTS}) reached`);
    try {
      const res = post
        ? await fetchWithTimeout(API_URL, { method: 'POST', body, headers: { 'User-Agent': USER_AGENT } })
        : await fetchWithTimeout(`${API_URL}?${body}`, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(`API error ${json.error.code}: ${json.error.info}`);
      return json;
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;
      console.warn(`[warn] ${params.action} attempt ${attempt + 1} failed (${err.message}). Retrying...`);
      await sleep(RETRY_BACKOFF_MS * (attempt + 1));
    }
  }
}

/** `|name = value` fields of the page's card template (values run to the next field line). */
function parseTemplateFields(wikitext) {
  const fields = {};
  let current = null;
  for (const line of wikitext.split('\n')) {
    const m = line.match(/^\|\s*(\w+)\s*=(.*)$/);
    if (m) {
      current = m[1];
      fields[current] = m[2];
    } else if (line.startsWith('}}')) {
      current = null; // card template closed; later lines are page content
    } else if (current) {
      fields[current] += `\n${line}`;
    }
    // The closing "}}" can also share a line with the last field.
    if (current) {
      const value = fields[current];
      const opens = (value.match(/\{\{/g) || []).length;
      const closes = (value.match(/\}\}/g) || []).length;
      if (closes > opens) {
        fields[current] = value.replace(/\}\}\s*$/, '');
        current = null;
      }
    }
  }
  return fields;
}

/**
 * The page's Japanese printing codes ("D-BT01/DSR02", "BT01/S02", "V-EB05/SSP01"...)
 * within `series`. Foreign (EN/TH/KR) printings and codes of other series are left out,
 * which also keeps the output from carrying codes nobody will match.
 */
function extractCodes(fields, series = ALL_SERIES) {
  const codes = new Set();
  for (const [key, value] of Object.entries(fields)) {
    if (!/^set\d+$/.test(key)) continue;
    for (const code of value.match(CARD_CODE_RE) || []) {
      if (FOREIGN_CODE_RE.test(code)) continue;
      if (series.includes(seriesOfCode(code))) codes.add(code.toUpperCase());
    }
  }
  return Array.from(codes);
}

/** Flattens (template-expanded) wikitext to the plain-text card format the modal renders. */
function wikitextToPlain(text) {
  if (!text) return null;
  const plain = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\[\[(?:Category|File|Image):[^\]]*\]\]/gi, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\{\{Ruby\|([^|}]*)\|[^}]*\}\}/g, '$1')
    // Calls to templates the wiki doesn't define (e.g. {{Unknown|5}}) survive expansion as-is.
    .replace(/\{\{[^{}]*\}\}/g, '')
    // Only real (lowercase) HTML tags -- card text uses <Race Name> brackets
    // ("your <Quintuplet> vanguard"), which must survive.
    .replace(/<\/?(?:span|font|u|b|i|s|sup|sub|small|big|div|p|ref|center|nowiki|abbr)\b[^>]*>/g, '')
    .replace(/'{2,}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
  return plain || null;
}

function toNumber(value) {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

/**
 * @param page            a MediaWiki page with its wikitext
 * @param series          the series being scraped
 * @param templateSeries  the series every page of the template it was listed
 *   under belongs to (D-era pages are kept even with no codes listed), or null
 */
function pageToCard(page, series, templateSeries = null) {
  const wikitext = page.revisions?.[0]?.slots?.main?.content || '';
  const fields = parseTemplateFields(wikitext);
  const codes = extractCodes(fields, series);
  const wholeTemplateWanted = templateSeries !== null && templateSeries.some((s) => series.includes(s));
  if (!wholeTemplateWanted && codes.length === 0) return null;
  // All-katakana names have no kanji field, only kana.
  const kanji = wikitextToPlain(fields.kanji || fields.jpname || fields.kana);
  if (codes.length === 0 && !kanji) return null;
  return {
    title: page.title,
    // Page titles carry a disambiguator when a name is shared ("Trickstar
    // (Anime Promo)"); an explicit |name= overrides the title entirely.
    nameEn: wikitextToPlain(fields.name) || page.title.replace(/\s*\([^()]*\)$/, ''),
    kanji,
    codes,
    // The series family of the template the page came from ({{DTable}} ->
    // 'D'), kept for pages that list no codes: it is all that lets
    // match-fandom.js match them by name within the right era.
    ...(templateSeries ? { family: familyOfSeries(templateSeries[0]) } : {}),
    grade: toNumber(fields.grade),
    power: toNumber(fields.power),
    shield: toNumber(fields.shield),
    nation: wikitextToPlain(fields.nation || fields.clan),
    rawEffect: fields.effect?.trim() || null,
    flavor: wikitextToPlain(fields.flavor),
  };
}

/**
 * Expands a batch's effect templates in one API round trip. If a malformed
 * effect swallows a separator (part count mismatch), the batch is split in
 * half and retried, so only the broken effect itself falls back to
 * unexpanded text.
 */
async function expandBatch(withEffect) {
  if (withEffect.length === 0) return;
  await sleep(DELAY_MS);
  const json = await apiRequest(
    {
      action: 'expandtemplates',
      prop: 'wikitext',
      title: 'Card',
      text: withEffect.map((c) => c.rawEffect).join(EXPAND_SEPARATOR),
    },
    { post: true }
  );
  const expanded = json.expandtemplates.wikitext.split(EXPAND_SEPARATOR.trim());
  if (expanded.length === withEffect.length) {
    withEffect.forEach((c, i) => {
      c.effect = wikitextToPlain(expanded[i]);
    });
  } else if (withEffect.length > 1) {
    const mid = Math.ceil(withEffect.length / 2);
    await expandBatch(withEffect.slice(0, mid));
    await expandBatch(withEffect.slice(mid));
  } else {
    const [c] = withEffect;
    console.warn(`[warn] Could not expand effect of "${c.title}"; using it with templates dropped.`);
    c.effect = wikitextToPlain(c.rawEffect.replace(/\{\{[^{}]*\}\}/g, ''));
  }
}

async function expandEffects(cards) {
  await expandBatch(cards.filter((c) => c.rawEffect));
  for (const c of cards) {
    c.effect ??= null;
    delete c.rawEffect;
  }
}

/**
 * Folds a scrape of some series into an earlier fandom-raw.json, replacing
 * only those series:
 *  - a page scraped now replaces the old copy of the same page, but keeps the
 *    old copy's codes of series that weren't scraped (a card printed in both
 *    D- and V- sets must not lose its D- codes when only V is rescraped);
 *  - an old page not scraped now is kept if it belongs to a series that
 *    wasn't scraped (any code outside the scraped series, or, with no codes,
 *    the family it came from), and dropped otherwise (it has left the wiki).
 * An old file with no `series` field was a D/DZ-only scrape.
 *
 * @returns {{series: string[], cards: object[]}}
 */
function mergeScrapes(existing, scrapedCards, scrapedSeries) {
  const oldSeries = existing.series || LEGACY_SERIES;
  const familyScraped = (family) => scrapedSeries.some((s) => familyOfSeries(s) === family);
  const byTitle = new Map();
  for (const old of existing.cards || []) {
    const otherCodes = (old.codes || []).filter((c) => !scrapedSeries.includes(seriesOfCode(c)));
    const family = old.family || (old.codes?.length ? null : familyOfSeries(LEGACY_SERIES[0]));
    const codelessOfOtherFamily = (old.codes || []).length === 0 && family && !familyScraped(family);
    if (otherCodes.length > 0 || codelessOfOtherFamily) {
      // A codeless page keeps its (possibly inferred) family: once the merged file
      // records a `series`, match-fandom no longer infers it, so it must be stamped.
      byTitle.set(old.title, { ...old, codes: otherCodes, ...(otherCodes.length === 0 && family ? { family } : {}) });
    }
  }
  for (const page of scrapedCards) {
    const prior = byTitle.get(page.title);
    byTitle.set(page.title, prior ? { ...page, codes: [...new Set([...page.codes, ...prior.codes])] } : page);
  }
  const series = ALL_SERIES.filter((s) => oldSeries.includes(s) || scrapedSeries.includes(s));
  return { series, cards: Array.from(byTitle.values()) };
}

/** Command line: --series D,DZ,V,G,OLD  --limit <batches>  --out <path> */
function parseArgs(argv) {
  const opts = { series: ALL_SERIES, limit: Infinity, out: OUTPUT_PATH };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
      return argv[++i];
    };
    if (flag === '--series') opts.series = parseSeries(value());
    else if (flag === '--limit') {
      opts.limit = Number(value());
      if (!Number.isInteger(opts.limit) || opts.limit < 1) throw new Error('--limit must be a positive integer');
    } else if (flag === '--out') opts.out = path.resolve(value());
    else throw new Error(`Unknown argument ${flag}`);
  }
  // A limited run is a sample: it must never replace the real data file, so
  // --limit insists on somewhere else to write.
  if (Number.isFinite(opts.limit) && opts.out === OUTPUT_PATH) {
    throw new Error('--limit makes a partial scrape; pass --out <path> so it does not overwrite data/fandom-raw.json');
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const byTitle = new Map();
  const sample = Number.isFinite(opts.limit) ? ` (sample: ${opts.limit} batch(es) per template)` : '';
  console.log(`Series: ${opts.series.join(', ')}${sample}`);

  for (const { title, series: templateSeries } of TEMPLATES) {
    // No point listing the whole {{DTable}} when no D-era series was asked for.
    if (templateSeries && !templateSeries.some((s) => opts.series.includes(s))) continue;
    let cont = {};
    let batch = 0;
    for (;;) {
      batch++;
      const json = await apiRequest({
        action: 'query',
        generator: 'embeddedin',
        geititle: title,
        geinamespace: '0',
        geilimit: '50',
        prop: 'revisions',
        rvprop: 'content',
        rvslots: 'main',
        ...cont,
      });
      // A page using both templates is only kept once.
      const batchCards = (json.query?.pages || [])
        .filter((page) => !byTitle.has(page.title))
        .map((page) => pageToCard(page, opts.series, templateSeries))
        .filter(Boolean);
      await expandEffects(batchCards);
      for (const c of batchCards) byTitle.set(c.title, c);

      if (batch % 20 === 0) console.log(`  ...${byTitle.size} card pages so far (${requestsMade} requests)`);
      if (!json.continue || batch >= opts.limit) break;
      cont = json.continue;
      await sleep(DELAY_MS);
    }
  }

  // A scrape of only some series must not erase the others from the file the
  // build reads: merge into what is already there.
  let existing = null;
  if (opts.series.length < ALL_SERIES.length && fs.existsSync(opts.out)) {
    try {
      existing = JSON.parse(fs.readFileSync(opts.out, 'utf8'));
    } catch (err) {
      throw new Error(`${opts.out} exists but can't be read (${err.message}); refusing to replace it with a partial scrape`);
    }
  }
  const merged = existing
    ? mergeScrapes(existing, Array.from(byTitle.values()), opts.series)
    : { series: opts.series, cards: Array.from(byTitle.values()) };
  const cards = merged.cards.sort((a, b) => a.title.localeCompare(b.title));
  if (existing) {
    console.log(`Merged into ${opts.out}: kept ${cards.length - byTitle.size} page(s) of other series, series now ${merged.series.join(', ')}`);
  }
  const output = {
    scrapedAt: new Date().toISOString(),
    sourceUrl: 'https://cardfight.fandom.com',
    license: 'CC BY-SA 3.0',
    series: merged.series,
    requestsMade,
    count: cards.length,
    cards,
  };
  writeFileAtomic(opts.out, JSON.stringify(output, null, 2));

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`Done. ${cards.length} card pages, ${requestsMade} requests, ${elapsedSec}s. Wrote ${opts.out}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during fandom scrape:', err);
    process.exit(1);
  });
}

module.exports = { extractCodes, pageToCard, parseArgs, mergeScrapes };
