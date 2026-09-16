'use strict';

/**
 * Integration step: combine the scraped catalog with the official-name
 * matcher and the local glossary/romaji engine into the final static
 * dataset the frontend serves from /data/cards.json.
 *
 * For each card: prefer a confident official English name (cf-vanguard);
 * otherwise fall back to the locally-built translation engine.
 */

const fs = require('fs');
const path = require('path');

const { translateCardName } = require('./translate-engine');
const { findOfficialName } = require('./match-official');

const CATALOG_PATH = path.join(__dirname, 'data', 'catalog-raw.json');
const SKILLS_PATH = path.join(__dirname, 'data', 'card-skills-raw.json');
const OUT_PATH = path.join(__dirname, '..', 'frontend', 'public', 'data', 'cards.json');

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
  const sourceCounts = { official: 0, glossary: 0, romaji: 0, mixed: 0, passthrough: 0 };
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

    const official = findOfficialName(c.setCode, c.nameJp);
    if (official) {
      nameEn = official.nameEn;
      translationSource = 'official';
      kind = official.kind;
      clan = official.clan;
      grade = official.grade;
      power = official.power;
      shield = official.shield;
      skillTextEn = official.skillText;
    } else {
      const local = translateCardName(c.nameJp);
      nameEn = local.nameEn;
      translationSource = local.source;
    }

    sourceCounts[translationSource] = (sourceCounts[translationSource] || 0) + 1;
    if (skillTextEn) skillTextEnCount++;

    const skillTextJp = skillsIndex[`${c.setSlug}/${c.id}`] || null;
    if (skillTextJp) skillTextJpCount++;

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
      // Only ever populated from a verified official-name match (see
      // match-official.js) -- null for every card without one.
      kind,
      clan,
      grade,
      power,
      shield,
      skillTextEn,
      // Best-effort JP ability text scraped per-card (scrape-card-detail.js);
      // null until that script has been run, or if it found nothing for
      // this card.
      skillTextJp,
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
  console.log(`Skill text: ${skillTextEnCount} official (EN), ${skillTextJpCount} scraped (JP).`);
  if (droppedUrls > 0) {
    console.warn(`${droppedUrls} card(s) had an imageUrl/detailUrl outside the yuyu-tei.jp allowlist (set to null).`);
  }
  const sizeMb = fs.statSync(OUT_PATH).size / (1024 * 1024);
  console.log(`Output size: ${sizeMb.toFixed(2)} MB`);
}

main();
