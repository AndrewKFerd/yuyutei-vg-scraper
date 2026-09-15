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
const OUT_PATH = path.join(__dirname, '..', 'frontend', 'public', 'data', 'cards.json');

function main() {
  const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const sourceCounts = { official: 0, glossary: 0, romaji: 0, mixed: 0, passthrough: 0 };

  const cards = raw.cards.map((c) => {
    let nameEn;
    let translationSource;

    const official = findOfficialName(c.setCode, c.nameJp);
    if (official) {
      nameEn = official.nameEn;
      translationSource = 'official';
    } else {
      const local = translateCardName(c.nameJp);
      nameEn = local.nameEn;
      translationSource = local.source;
    }

    sourceCounts[translationSource] = (sourceCounts[translationSource] || 0) + 1;

    return {
      id: c.id,
      setCode: c.setCode,
      setSlug: c.setSlug,
      rarity: c.rarity,
      nameJp: c.nameJp,
      nameEn,
      translationSource,
      price: c.price,
      priceDisplay: c.priceDisplay,
      stock: c.stock,
      imageUrl: c.imageUrl,
      detailUrl: c.detailUrl,
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
  const sizeMb = fs.statSync(OUT_PATH).size / (1024 * 1024);
  console.log(`Output size: ${sizeMb.toFixed(2)} MB`);
}

main();
