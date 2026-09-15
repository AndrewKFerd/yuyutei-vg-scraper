'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const compression = require('compression');

const { scrapeSet } = require('./scraper');
const { translateBatch, getCachedOnly } = require('./translate');

const PORT = process.env.PORT || 3001;
const DEFAULT_SET = 'dzbt16';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DATA_DIR = path.join(__dirname, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

function cacheFilePath(set) {
  // Keep it filesystem-safe; set codes are expected to be simple slugs anyway.
  const safe = String(set).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DATA_DIR, `cards-${safe}.json`);
}

function readCache(set) {
  const file = cacheFilePath(set);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function writeCache(set, payload) {
  const file = cacheFilePath(set);
  try {
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.error(`[cache] Failed to write cache for set "${set}":`, err.message);
  }
}

function isFresh(cachedAt) {
  if (!cachedAt) return false;
  const age = Date.now() - new Date(cachedAt).getTime();
  return age >= 0 && age < CACHE_TTL_MS;
}

// Tracks an in-flight background translation job per set, so concurrent
// requests for the same cold set don't each kick off their own full
// translateBatch() run against the (rate-limit-sensitive) translate endpoint.
const inFlightTranslation = new Map();

function buildPayload(set, setNameJp, cards, translations) {
  return {
    set,
    setNameJp,
    count: cards.length,
    cachedAt: new Date().toISOString(),
    cards: cards.map((c) => ({
      id: c.id,
      setCode: c.setCode,
      rarity: c.rarity,
      nameJp: c.nameJp,
      nameEn: translations.get(c.nameJp) || c.nameJp,
      price: c.price,
      priceDisplay: c.priceDisplay,
      stock: c.stock,
      imageUrl: c.imageUrl,
      detailUrl: c.detailUrl,
    })),
  };
}

async function getCardsForSet(set, forceRefresh) {
  if (!forceRefresh) {
    const cached = readCache(set);
    if (cached && isFresh(cached.cachedAt)) {
      return cached;
    }
  }

  const { setNameJp, cards } = await scrapeSet(set);
  const uniqueNames = cards.map((c) => c.nameJp);

  // Serve immediately using whatever's already translated on disk. Anything
  // not yet cached falls back to the Japanese name for now — the background
  // job below fills it in, and the NEXT request (or a client refetch) picks
  // up the completed translation from the cache file, without ever blocking
  // an HTTP response on the slow/rate-limit-sensitive translate endpoint.
  const cachedTranslations = getCachedOnly(uniqueNames);
  const payload = buildPayload(set, setNameJp, cards, cachedTranslations);
  writeCache(set, payload);

  const stillNeedsTranslation = uniqueNames.some(
    (jp) => !cachedTranslations.has(jp) || cachedTranslations.get(jp) === jp
  );

  if (stillNeedsTranslation && !inFlightTranslation.has(set)) {
    const job = translateBatch(uniqueNames)
      .then((full) => {
        writeCache(set, buildPayload(set, setNameJp, cards, full));
      })
      .catch((err) => {
        console.error(`[translate] Background translation failed for set "${set}":`, err.message);
      })
      .finally(() => {
        inFlightTranslation.delete(set);
      });
    inFlightTranslation.set(set, job);
  }

  return payload;
}

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(compression());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/cards', async (req, res) => {
  const set = (req.query.set || DEFAULT_SET).toString().toLowerCase();
  const refresh = req.query.refresh === '1';

  try {
    const payload = await getCardsForSet(set, refresh);
    res.json(payload);
  } catch (err) {
    console.error(`[api] Failed to get cards for set "${set}":`, err.message);
    res.status(502).json({ error: 'Failed to fetch card data', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`realtime-yuyutei backend listening on http://localhost:${PORT}`);
});
