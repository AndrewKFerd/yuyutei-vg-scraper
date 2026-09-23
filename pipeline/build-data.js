'use strict';

/**
 * Integration step: combine the scraped catalog with the official-name
 * matcher and the local glossary/romaji engine into the final dataset,
 * written locally for upload-cards.js to push to Supabase Storage.
 *
 * For each card: prefer a confident official English name (cf-vanguard);
 * then, for D-/DZ- cards, a fan translation from the Cardfight!! Vanguard
 * wiki (scrape-fandom.js); otherwise fall back to the locally-built
 * translation engine.
 */

const fs = require('fs');
const path = require('path');

const { translateCardName } = require('./translate-engine');
const { findOfficialName } = require('./match-official');
const { findFandomCard } = require('./match-fandom');
const { groupKey } = require('./card-group');

const CATALOG_PATH = path.join(__dirname, 'data', 'catalog-raw.json');
const SKILLS_PATH = path.join(__dirname, 'data', 'card-details-raw.json');
// Uploaded to Supabase Storage by upload-cards.js -- the frontend fetches
// it through api/cards.js, a private-bucket proxy, not as a static asset.
const OUT_PATH = path.join(__dirname, 'data', 'cards.json');

function loadSkillsIndex() {
  try {
    const raw = JSON.parse(fs.readFileSync(SKILLS_PATH, 'utf8'));
    return raw.skills || {};
  } catch (err) {
    console.warn(
      `[build-data] No ${SKILLS_PATH} found (${err.message}) -- cards will have no Japanese ` +
      'skill text. Run scrape-card-detail.js first if you want it.'
    );
    return {};
  }
}

// Both fields end up as raw `<a href>`/`<img src>` values in the frontend.
// Cheap belt-and-suspenders check against a compromised/malformed source
// page ever slipping a non-http(s) or off-site URL (e.g. `javascript:`)
// into the shipped dataset.
const ALLOWED_URL_RE = /^https:\/\/(card\.)?yuyu-tei\.jp\//i;

function sanitizeUrl(url) {
  return typeof url === 'string' && ALLOWED_URL_RE.test(url) ? url : null;
}

function main() {
  const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const skillsIndex = loadSkillsIndex();
  const sourceCounts = { official: 0, fandom: 0, glossary: 0, romaji: 0, mixed: 0, passthrough: 0 };
  let droppedUrls = 0;
  let skillTextEnCount = 0;
  let skillTextJpCount = 0;

  const cards = raw.cards.map((c) => {
    let nameEn;
    let translationSource;
    let kind = null;
    let clan = null;
    let grade = null;
    let power = null;
    let shield = null;
    let skillTextEn = null;
    let flavorEn = null;
    let wikiTitle = null;

    const official = findOfficialName(c.setCode, c.nameJp);
    const fandom = official ? null : findFandomCard(c.setCode, c.nameJp);
    if (official) {
      nameEn = official.nameEn;
      translationSource = 'official';
      kind = official.kind;
      clan = official.clan;
      grade = official.grade;
      power = official.power;
      shield = official.shield;
      // cf-vanguard delivers all abilities as one run-on line; the printed
      // card starts each on its own line, so restore that at ability
      // keywords (the modal renders with whitespace-pre-line).
      skillTextEn = official.skillText
        ? official.skillText.replace(/(?<=\S)\s*(\[(?:CONT|ACT|AUTO)\])/g, '\n$1')
        : null;
    } else if (fandom) {
      // Fan translation (CC BY-SA) -- the frontend credits and links
      // wikiTitle's page wherever this text is shown.
      nameEn = fandom.nameEn;
      translationSource = 'fandom';
      clan = fandom.nation;
      grade = fandom.grade;
      power = fandom.power;
      shield = fandom.shield;
      skillTextEn = fandom.effect;
      flavorEn = fandom.flavor;
      // Usually identical to the name -- only shipped when it differs
      // (a disambiguated title), the frontend falls back to nameEn.
      wikiTitle = fandom.title !== fandom.nameEn ? fandom.title : null;
    } else {
      const local = translateCardName(c.nameJp);
      nameEn = local.nameEn;
      translationSource = local.source;
    }

    sourceCounts[translationSource] = (sourceCounts[translationSource] || 0) + 1;
    if (skillTextEn) skillTextEnCount++;

    // Per-card detail scraped from yuyu-tei (scrape-card-detail.js), keyed
    // by card identity rather than listing so every foil/parallel variant
    // shares the one fetched result. The stat line fills in whatever the
    // official match didn't provide -- for the ~78% of cards with no
    // English release this is the only source. Japanese labels are kept
    // as-is for text fields (kind/clan) so the UI isn't showing a
    // machine-mangled "translation" of a proper noun.
    const detail = skillsIndex[groupKey(c)] || null;
    const skillTextJp = detail?.effect || null;
    // The modal shows one flavor line, English when available -- skip
    // shipping the Japanese one it would never display.
    const flavorJp = flavorEn ? null : detail?.flavor || null;
    if (skillTextJp) skillTextJpCount++;
    if (detail) {
      kind ??= detail.kind ?? null;
      clan ??= detail.clan ?? detail.nation ?? null;
      grade ??= detail.grade ?? null;
      power ??= detail.power ?? null;
      shield ??= detail.shield ?? null;
    }

    const imageUrl = sanitizeUrl(c.imageUrl);
    const detailUrl = sanitizeUrl(c.detailUrl);
    if (!imageUrl || !detailUrl) droppedUrls++;

    return {
      // c.id is yuyu-tei's per-set product number, not globally unique
      // (yuyu-tei reuses it across sets) — compose with setSlug so every
      // card in this catalog has a truly unique id (used as the frontend's
      // React list key).
      id: `${c.setSlug}/${c.id}`,
      setCode: c.setCode,
      setSlug: c.setSlug,
      rarity: c.rarity,
      nameJp: c.nameJp,
      nameEn,
      translationSource,
      // From the official English match when there is one, else from the
      // yuyu-tei detail scrape (Japanese labels) -- null if neither had it.
      kind,
      clan,
      grade,
      power,
      shield,
      // English rules text: official for cards with an EN release, else the
      // wiki's fan translation (translationSource says which).
      skillTextEn,
      flavorEn,
      // Source page on cardfight.fandom.com for fan-translated text, for
      // credit -- null when it's just nameEn.
      wikiTitle,
      // Japanese rules/flavor text from scrape-card-detail.js; null until
      // that's been run, or for cards yuyu-tei hasn't filled in (brand-new
      // sets) or that have no text (tokens/markers).
      skillTextJp,
      flavorJp,
      price: c.price,
      priceDisplay: c.priceDisplay,
      stock: c.stock,
      imageUrl,
      detailUrl,
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    count: cards.length,
    cards,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload), 'utf8');

  console.log(`Wrote ${cards.length} cards to ${OUT_PATH}`);
  console.log('translationSource breakdown:', sourceCounts);
  console.log(`Skill text: ${skillTextEnCount} English (official or fan),${skillTextJpCount} scraped (JP).`);
  if (droppedUrls > 0) {
    console.warn(`${droppedUrls} card(s) had an imageUrl/detailUrl outside the yuyu-tei.jp allowlist (set to null).`);
  }
  const sizeMb = fs.statSync(OUT_PATH).size / (1024 * 1024);
  console.log(`Output size: ${sizeMb.toFixed(2)} MB`);
}

main();
