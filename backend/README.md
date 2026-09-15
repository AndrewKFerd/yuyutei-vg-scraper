# realtime-yuyutei backend

Scrapes card listing data from [yuyu-tei.jp](https://yuyu-tei.jp) (a Japanese TCG
marketplace) and serves it as JSON, with Japanese card names machine-translated
to English, so a frontend can offer an English-language search UI over the cards.

## Install

```
npm install
```

## Run

```
npm start
```

or

```
node server.js
```

The server listens on port `3001` by default.

## Environment variables

- `PORT` — port to listen on (default `3001`).

## API

- `GET /api/health` — `{ "status": "ok" }`
- `GET /api/cards?set=dzbt16` — scraped + translated card list for a set.
  - `set` defaults to `dzbt16` if omitted.
  - `?refresh=1` forces a fresh scrape, bypassing the 6-hour on-disk cache.

### Cold-start behavior (stale-while-revalidate)

On a cold or expired cache, `/api/cards` scrapes yuyu-tei immediately and
responds right away using whatever English names are already in the
translation cache — any name not yet cached is served as its Japanese
original for that one response, so the request never blocks on the
translation endpoint. A background job then translates the remaining names
and rewrites `data/cards-{set}.json` when done (usually well under a minute).
The *next* request for that set (within the 6-hour TTL) is served straight
from that file and will have the fully-translated names.

## Cache files (in `data/`)

- `data/translations.json` — a permanent cache mapping every unique Japanese
  card name seen so far to its English machine translation. Loaded on startup
  and only added to (never re-fetched for names already present), so repeat
  runs and repeat sets don't re-hit the translation endpoint for names already
  seen. Saved incrementally during a translation run (not just at the end),
  so a long cold-start batch doesn't lose progress if the process is
  interrupted partway through.
- `data/cards-{set}.json` — the last scraped + translated card list for a
  given set, along with a `cachedAt` timestamp. Used to serve `/api/cards`
  without re-scraping yuyu-tei or re-translating names as long as the cache is
  less than 6 hours old. Pass `?refresh=1` to bypass this and force a fresh
  scrape.

Both cache directories/files are created automatically on first run.

## Note on the translate endpoint transport

Card names are translated via the free, no-API-key
`translate.googleapis.com/translate_a/single` endpoint. In testing, Node's
built-in `fetch` (undici) got fingerprinted and immediately blocked by
Google with an HTTP 429 "automated queries" page — even for a single,
isolated request — while plain `curl` from the same machine succeeded
reliably, including several fully concurrent requests. `translate.js`
therefore shells out to the system `curl` binary (via Node's built-in
`child_process.execFile`, so no extra dependency) for the actual translate
HTTP call. `curl` must be on `PATH` (present by default on Windows 10+,
macOS, and virtually all Linux distros/containers).
