'use strict';

/**
 * Scrapes fan-translated English names and card text for D-era (D-/DZ-)
 * cards from the Cardfight!! Vanguard Fandom wiki
 * (https://cardfight.fandom.com), for the many cards cf-vanguard.com has no
 * official English release of yet (whole current sets, promos, structure
 * decks...). Writes data/fandom-raw.json, which match-fandom.js indexes for
 * build-data.js.
 *
 * Uses the MediaWiki API rather than scraping HTML: D-era card pages use
 * {{DTable}}, so a `generator=embeddedin` listing returns every card page's
 * wikitext, 50 at a time. Older-era cards reprinted in D-/DZ- sets (D-VS,
 * D-PV...) keep their original {{CardTable}} page, so that listing is walked
 * too, keeping only pages that list a D-/DZ- printing. Effect text leans on
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

const API_URL = 'https://cardfight.fandom.com/api.php';
const OUTPUT_PATH = path.join(__dirname, 'data', 'fandom-raw.json');
// MediaWiki etiquette: identify the client instead of posing as a browser.
const USER_AGENT = 'yuyutei-vg-scraper/1.0 (https://github.com/AndrewKFerd/yuyutei-vg-scraper)';
const DELAY_MS = 500;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 2000;
const MAX_REQUESTS = 1200; // ~410 listing batches + expansions; headroom for retries
const EXPAND_SEPARATOR = '\n@@CARD-SEPARATOR@@\n';

// Card-page templates to walk, and whether every page using it is D-era.
const TEMPLATES = [
  { title: 'Template:DTable', allDEra: true },
  { title: 'Template:CardTable', allDEra: false },
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
        ? await fetch(API_URL, { method: 'POST', body, headers: { 'User-Agent': USER_AGENT } })
        : await fetch(`${API_URL}?${body}`, { headers: { 'User-Agent': USER_AGENT } });
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

// "D-BT01/DSR02", "DZ-BT17/SEC01", "D-PR/756", "DZ-SS04e/012EN"...
const CARD_CODE_RE = /\bDZ?-[A-Za-z]+\d*[A-Za-z]*\/[A-Za-z]*\d+[A-Za-z]*\b/g;
// Codes of English/Thai printings -- yuyu-tei only sells Japanese ones.
const FOREIGN_CODE_RE = /(EN|TH)(\/|$)/i;

function extractCodes(fields) {
  const codes = new Set();
  for (const [key, value] of Object.entries(fields)) {
    if (!/^set\d+$/.test(key)) continue;
    for (const code of value.match(CARD_CODE_RE) || []) {
      if (!FOREIGN_CODE_RE.test(code)) codes.add(code.toUpperCase());
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

function pageToCard(page, allDEra) {
  const wikitext = page.revisions?.[0]?.slots?.main?.content || '';
  const fields = parseTemplateFields(wikitext);
  const codes = extractCodes(fields);
  if (!allDEra && !codes.some((code) => /^DZ?-/.test(code))) return null;
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

async function main() {
  const startedAt = Date.now();
  const byTitle = new Map();
  let batch = 0;

  for (const { title, allDEra } of TEMPLATES) {
    let cont = {};
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
        .map((page) => pageToCard(page, allDEra))
        .filter(Boolean);
      await expandEffects(batchCards);
      for (const c of batchCards) byTitle.set(c.title, c);

      if (batch % 20 === 0) console.log(`  ...${byTitle.size} D-era card pages so far (${requestsMade} requests)`);
      if (!json.continue) break;
      cont = json.continue;
      await sleep(DELAY_MS);
    }
  }

  const cards = Array.from(byTitle.values()).sort((a, b) => a.title.localeCompare(b.title));
  const output = {
    scrapedAt: new Date().toISOString(),
    sourceUrl: 'https://cardfight.fandom.com',
    license: 'CC BY-SA 3.0',
    requestsMade,
    count: cards.length,
    cards,
  };
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`Done. ${cards.length} card pages, ${requestsMade} requests, ${elapsedSec}s. Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Fatal error during fandom scrape:', err);
  process.exit(1);
});
