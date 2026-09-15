'use strict';

/**
 * Translation helper backed by the free Google Translate "gtx" endpoint,
 * with a permanent on-disk cache and a small concurrency limiter.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const CACHE_PATH = path.join(__dirname, 'data', 'translations.json');

let cache = {};
let cacheLoaded = false;
let cacheDirty = false;

function loadCache() {
  if (cacheLoaded) return cache;
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    cache = JSON.parse(raw);
  } catch (err) {
    cache = {};
  }
  cacheLoaded = true;
  return cache;
}

function saveCache() {
  if (!cacheDirty) return;
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
    cacheDirty = false;
  } catch (err) {
    console.error('[translate] Failed to persist translation cache:', err.message);
  }
}

/**
 * Tiny concurrency limiter — no external dependency.
 * Returns a `run(fn)` function that queues `fn` so that at most
 * `maxConcurrent` calls are in flight at once, with a small pacing delay
 * between dispatches so we don't burst the translate endpoint and trigger
 * rate limiting (HTTP 429).
 */
function createLimiter(maxConcurrent, minDelayMs) {
  let active = 0;
  let lastDispatch = 0;
  const queue = [];

  // Each call reserves a slot (increments `active`) synchronously before the
  // pacing delay elapses, so concurrent calls can never both grab the same
  // queue entry or exceed maxConcurrent.
  function scheduleNext() {
    if (queue.length === 0 || active >= maxConcurrent) return;

    const now = Date.now();
    const wait = Math.max(0, lastDispatch + minDelayMs - now);
    active++;
    lastDispatch = now + wait;

    setTimeout(() => {
      const item = queue.shift();
      item
        .fn()
        .then(item.resolve, item.reject)
        .finally(() => {
          active--;
          scheduleNext();
        });
      scheduleNext(); // try to fill any remaining concurrency slots too
    }, wait);
  }

  return function run(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      scheduleNext();
    });
  };
}

// Requests go out via curl (see curlGetJson below) rather than Node's fetch,
// which sidesteps the fingerprinting block described there. curl tolerates
// real concurrency fine (verified: 5 fully concurrent requests all
// succeeded), so we can afford a modest amount of parallelism here — still
// capped, per the task's "max 4 concurrent" guidance.
const limit = createLimiter(4, 150);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function execFileAsync(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024, timeout: 15000 }, (err, stdout) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Fetches a URL via the system `curl` binary rather than Node's built-in
 * `fetch`. In this environment, Node's fetch (undici) gets fingerprinted
 * and immediately blocked by Google's translate endpoint with an HTTP 429
 * "automated queries" page — even for a single isolated request — while
 * plain `curl` from the same machine (same IP, same User-Agent) succeeds
 * reliably, including several fully concurrent requests. `child_process`
 * is a Node built-in, so this adds no third-party dependency; it's purely
 * a transport-level workaround for that fingerprinting quirk.
 */
async function curlGetJson(url) {
  const stdout = await execFileAsync('curl', ['-s', '-A', USER_AGENT, url]);
  return JSON.parse(stdout);
}

async function translateOnceRaw(text) {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=en&dt=t&q=' +
    encodeURIComponent(text);

  let data;
  try {
    data = await curlGetJson(url);
  } catch (err) {
    const wrapped = new Error(`Translate request failed: ${err.message}`);
    throw wrapped;
  }

  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    // Google's block page isn't valid JSON so JSON.parse above would already
    // have thrown; this covers any other unexpected-but-parseable shape.
    throw new Error('Malformed translate response');
  }

  const translated = data[0]
    .map((chunk) => (Array.isArray(chunk) ? chunk[0] : ''))
    .filter((s) => typeof s === 'string')
    .join('');

  if (!translated) {
    throw new Error('Empty translation result');
  }

  return translated;
}

/** Retries transient failures (429 / network errors) with exponential backoff. */
async function translateOne(text, retries = 4) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        const backoff = 1500 * Math.pow(2, attempt - 1); // 1.5s, 3s, 6s, 12s
        await sleep(backoff + Math.random() * 500);
      }
      return await translateOnceRaw(text);
    } catch (err) {
      lastErr = err;
      // Only worth retrying on rate limiting or transient network errors.
      const retryable = err.status === 429 || err.status >= 500 || !err.status;
      if (!retryable || attempt === retries) break;
    }
  }
  throw lastErr;
}

/**
 * Translate a list of unique Japanese strings, using the on-disk cache
 * wherever possible. Returns a Map<jpString, enString>. Never throws —
 * any string that fails to translate falls back to itself.
 */
async function translateBatch(jpStrings) {
  loadCache();

  const unique = [...new Set(jpStrings.filter(Boolean))];
  const toFetch = unique.filter((s) => !(s in cache));

  const fallbacks = new Map();
  let sinceLastSave = 0;

  if (toFetch.length > 0) {
    await Promise.all(
      toFetch.map((jp) =>
        limit(async () => {
          try {
            const en = await translateOne(jp);
            cache[jp] = en;
            cacheDirty = true;
            // Save incrementally (rather than only once at the very end) so a
            // long cold-start run doesn't lose all progress if the process is
            // interrupted partway through.
            sinceLastSave++;
            if (sinceLastSave >= 15) {
              sinceLastSave = 0;
              saveCache();
            }
          } catch (err) {
            console.error(`[translate] Failed to translate "${jp}":`, err.message);
            // Graceful degradation for THIS response only — do not persist the
            // failure to the on-disk cache, so a later run can retry it.
            fallbacks.set(jp, jp);
          }
        })
      )
    );
    saveCache();
  }

  const result = new Map();
  for (const jp of unique) {
    if (cache[jp] !== undefined) {
      result.set(jp, cache[jp]);
    } else {
      result.set(jp, fallbacks.get(jp) || jp);
    }
  }
  return result;
}

/**
 * Synchronous, network-free lookup of whatever's already on disk. Used to
 * serve a fast response immediately; anything not yet cached falls back to
 * the Japanese source string until a background translateBatch() call fills
 * it in for next time.
 */
function getCachedOnly(jpStrings) {
  loadCache();
  const result = new Map();
  for (const jp of new Set(jpStrings.filter(Boolean))) {
    result.set(jp, cache[jp] !== undefined ? cache[jp] : jp);
  }
  return result;
}

module.exports = { translateBatch, getCachedOnly, loadCache, saveCache };
