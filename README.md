# yuyutei-vg-scraper

An English-language, Gelbooru-style search UI over yuyu-tei.jp's entire Cardfight!! Vanguard singles catalog.

## Architecture

Data is generated **offline**, ahead of time, not fetched live at request time.
The built dataset lives in a **private** Supabase Storage bucket; the only
server-side pieces in production are a few thin Vercel Functions that proxy
an allowlist of its objects.

```
pipeline/     -> scrapes yuyu-tei + cf-vanguard.com, translates card names,
                 records a price/stock history, writes pipeline/data/catalog.json
                 + details/<set>.json (and the full cards.json, see "Catalog
                 split" below) plus history-public.json and movers.json,
                 uploads them to Supabase Storage (private bucket -- see
                 pipeline/upload-cards.js)
frontend/     -> Vite + React + Tailwind static site
frontend/api/ -> catalog.js, details/[set].js, history.js, movers.js (and the
                 legacy cards.js): Vercel Functions that proxy catalog.json,
                 details/<set>.json, history-public.json and movers.json from
                 the private bucket (they hold the Supabase S3 credentials
                 server-side, and only serve that allowlist -- the private
                 price-history.json is never reachable). The frontend fetches
                 /api/catalog on load, /api/details/<set> when a card of that
                 set is opened, and /api/history + /api/movers lazily, and
                 renders/searches everything client-side
frontend/vercel.json -> pins the functions to icn1 (Seoul), next to the bucket
```

### Catalog split

The full per-card file (`cards.json`, ~30 MB) was over Vercel's cacheable
response size, so `/api/cards` never hit the edge cache: every visitor's daily
load ran the function and pulled 30 MB out of Supabase. `build-data.js` now
also writes:

- `catalog.json` — the slim catalog the grid, search, filters and Market Movers
  use (id, set, rarity, names, translationSource, price, stock, chg7d; ~6 MB raw,
  ~0.6 MB brotli). `imageUrl`, `detailUrl` and `priceDisplay` are left out when
  they follow from the id / price (the client recomputes them,
  `frontend/src/catalogFormat.js`) and kept only where they differ.
- `details/<setSlug>.json` — one file per set (~300), card id -> the heavy fields
  (skill text, flavor, kind/clan/grade/power/shield, wiki title), fetched by the
  card modal when it opens a card of that set.

`upload-cards.js` uploads the shards first, then `catalog.json`, so the catalog never refers to a shard the bucket lacks. Each run lists `details/` in the bucket and uploads only shards that are missing there or whose ETag differs from the local content's MD5, so a bucket changed or emptied elsewhere heals itself (`data/upload-manifest.json` only caches the ETags the bucket returned, for a store whose ETags are not MD5s; `FORCE_SHARD_UPLOAD=1` sends them all). After the new `catalog.json` is up, remote shards of sets that no longer exist are deleted, but only after staying orphaned for 48 h (first-seen times are kept in the manifest, so visitors holding a day-old catalog never hit a deleted shard, and a set that reappears is left alone) and never more than a fifth of them per run.

**Transition:** the pipeline uploads independently of Vercel deploys, so the
frontend already deployed still loads `cards.json` via `/api/cards`. Both files
keep being built and uploaded until the new frontend is live; after that,
`/api/cards` (`frontend/api/cards.js`, the `cards.json` entries in
`upload-cards.js`'s `OBJECTS` and the allowlist) can be dropped. Deploy order:
let at least one pipeline run upload `catalog.json` and the shards, then deploy
the frontend. `build-data.js` still reads the previous `cards.json` for its
official-name-loss gate.

### `pipeline/`

1. `scrape-catalog.js` — paginates yuyu-tei's global VG search endpoint and writes every set's card listings to `pipeline/data/catalog-raw.json` (~28k cards across 300+ sets).
2. `scrape-cf-vanguard.js` + `match-official.js` — scrapes the official English Cardfight!! Vanguard database and, where a card's JP set code has a verified English release, supplies its real official name plus its kind/clan/grade/power/shield and English skill text. An incomplete scrape (a set that didn't fully load, a family cut short) or one >2% smaller than the last keeps the previous `cf-vanguard-raw.json` instead of overwriting it (`reference-gate.js`), and still exits 0 so the refresh carries on with the last good names.
3. `scrape-card-detail.js` — fetches each card's own yuyu-tei detail page for its Japanese skill text, as a fallback for cards with no official English release yet. This is a per-card scrape (~28k requests) so it's slow (multiple hours) and resumable/checkpointed; run it as a separate, optional step. Every run (including `--force`, `--sets` and `--limit` ones) merges into the existing `card-details-raw.json` rather than replacing it. `--missing` narrows a run to cards a fetch could actually fill in (never fetched, or fetched while yuyu-tei's page was still blank), skipping markers/tokens/vanilla units whose pages are complete but have no 効果, and cards that already have English text — ~785 cards (~15 min) instead of the ~3,700 a plain run retries; most of the ~3.5k cards with no skill text at all are such cards, or sets where yuyu-tei itself still shows "-". The selectors were re-checked against live pages on 2026-10-07 (see the file header).
4. `scrape-fandom.js` + `match-fandom.js` — pulls fan-translated English names, card text and flavor for D-/DZ-, V-, G- and older (unprefixed: BT, EB, TD, PR...) cards from the [Cardfight!! Vanguard Wiki](https://cardfight.fandom.com) via its MediaWiki API (full run: ~820 requests, ~25-30 min), matched by card code, then by Japanese name (name matching only considers wiki pages from the same series family, so a V-era card can't match an unrelated D-era namesake). `--series D,DZ,V,G,OLD` picks the series (default: all; a subset is merged into the existing `fandom-raw.json`, replacing only the selected series, so the others keep their names; the series are read off the code prefix, see `fandom-series.js`), `--limit <batches> --out <file>` makes a small sample without touching `data/fandom-raw.json`. Used for cards with no official English release; the card popup credits and links the wiki page (the text is CC BY-SA). Manual, occasional step, since wiki text changes slowly.
5. `translate-engine.js` + `data/glossary.json` — a zero-network, deterministic JA→EN engine (hand-authored glossary + Hepburn romanization) used as the name fallback whenever there's no official English release yet.
6. `record-history.js` + `price-history.js` — appends this run's prices/stock to `data/price-history.json`, a change log (a listing gets a new `[minute, price, stock]` entry only when something changed), then writes the served `data/history-public.json` (card charts) and `data/movers.json` (24h/7d/30d risers, drops, sold out, restocked, selling fast). It keeps `price-history.prev.json` plus one dated copy per day in `data/history-backups/` (newest 14). It never starts a fresh history silently: a missing local file is restored from the bucket (so run it with `--env-file=.env`), and only if the bucket has none either does it accept `backfill-history.js` (seeds the history from the `cards.json` snapshots in git, Sep 15–18 2026) or `HISTORY_INIT=1`.
7. `build-data.js` — combines the above (official name/skill text first, then the wiki fan translation, then the local engine + scraped JP skill text) into `pipeline/data/cards.json` (plus the `catalog.json` / `details/` split, see "Catalog split"), with a small `chg7d` field on listings whose price moved in the last 7 days.
8. `upload-cards.js` — uploads `price-history.json` (private backup, never served), `history-public.json`, `movers.json`, the changed detail shards, `catalog.json` and `cards.json` to the private Supabase Storage bucket, via its S3-compatible endpoint. Needs `SUPABASE_S3_*` env vars (see `.env.example`); run with `node --env-file=.env upload-cards.js`.

**Safety gates** (each exits 1, which aborts the scheduled run before anything is recorded or uploaded — except the cf-vanguard one, which keeps the previous file and lets the run continue) and their manual overrides:

| Gate | Where | Override |
|---|---|---|
| cf-vanguard scrape is incomplete (a set parsed fewer cards than the site reported, or a family was cut short by a failed request) or >2% smaller than the previous `cf-vanguard-raw.json` — keeps the previous file | `scrape-cf-vanguard.js` | `ALLOW_OFFICIAL_SHRINK=1` |
| Over 2% of the listings that had an official English name in the previous `cards.json` (and are still listed) would lose it | `build-data.js` | `ALLOW_OFFICIAL_SHRINK=1` |
| Catalog is empty, or more than 2% smaller than the largest of the last 7 days' runs (`build-data.js`: than the `cards.json` it would replace) — a partial scrape; one skipped page is ~2% | `record-history.js`, `build-data.js` | `ALLOW_CATALOG_SHRINK=1` (also makes the smaller count the new baseline) |
| Catalog content looks misread: under 90% of listings have a parseable price, or over 25% of tracked listings changed at once | `record-history.js` | `ALLOW_MASS_CHANGE=1` |
| No price history locally, and the bucket has none either (or couldn't be checked) | `record-history.js` | `HISTORY_INIT=1` (starts empty; only honored once the bucket was checked) |
| Local `price-history.json` is under 90% the size of the bucket's copy (the history only grows) — nothing is uploaded | `upload-cards.js` | `FORCE_HISTORY_UPLOAD=1` |
| Backfilling while a history already exists locally / in the bucket, or without bucket credentials | `backfill-history.js` | `--force` / `--force-remote` / `--no-remote-check` |

**This runs on its own**, via `refresh-and-push.ps1` on a recurring local Windows Task Scheduler job (see that file's header for why it's local-only and not a GitHub Actions cron: yuyu-tei hard-blocks GitHub's runner IPs). It scrapes the catalog, records the price history (straight after the catalog scrape, so the run gate aborts a bad scrape before the slow cf-vanguard step), scrapes cf-vanguard (at most about once a day: the step is skipped while `cf-vanguard-raw.json` is under 20 h old, since official names change weekly at most and the scrape is ~9 of a run's ~12 minutes; `FORCE_CF_VANGUARD=1` forces it, and a rejected scrape keeps the old file and its old timestamp so the next run retries), rebuilds `cards.json`, and uploads everything straight to Supabase — no git commit, no Vercel redeploy needed for a data refresh; the live site just fetches fresh data through `/api/catalog`, `/api/details/<set>`, `/api/history` and `/api/movers` (see below), subject to each visitor's own daily client-side cache. Overlapping runs are prevented by `pipeline/refresh.lock`, which records the owner's PID and process start time (`pipeline/refresh-lock.ps1` holds the decision logic, tested by `test/refresh-lock.test.ps1`): a run whose owner is still alive is skipped, however old the lock (a run that slept and woke up carries on), and only a lock whose owner is gone or whose PID was reused is taken over. An owner whose start time can't be read (a PowerShell at another elevation) is told apart by process name: not PowerShell means gone (taken over), PowerShell is never taken over or killed (the run skips with a warning). Ceiling: an owner verified as the lock's owner and still running after 3 h is presumed hung and is killed with its child processes (`taskkill /T /F`); the lock is taken over only once it is gone. As a backstop outside the script, set the Task Scheduler task to "If the task is already running: Do not start a new instance" and "Stop the task if it runs longer than 2 hours"; every network call has a timeout (60 s for HTTP; for S3 15 s to connect, 120 s idle, 15 min overall) so a dropped connection fails and retries instead of hanging. It also skips `scrape-fandom.js`, which reuses its last `data/fandom-raw.json` until you rerun it by hand. The other piece it deliberately skips is `scrape-card-detail.js` (see below) — a full run takes hours, so it's a manual, occasional step.

The outputs of the two slow, manual scrapes — `data/card-details-raw.json` and `data/fandom-raw.json` — are committed, so a fresh clone (or another machine) can build immediately without redoing them. The others (`catalog-raw.json`, `cf-vanguard-raw.json`, `cards.json`) are regenerated on every refresh and stay gitignored, as do the history files (`price-history.json`, its derivatives and `data/history-backups/`) — the bucket copy of `price-history.json` is their backup, since unlike everything else here it can't be regenerated.

To run any of it by hand (e.g. to test a pipeline change, or to run `scrape-card-detail.js`):
```
cd pipeline
npm install
npm run scrape                        # yuyu-tei catalog -> data/catalog-raw.json
node --env-file=.env backfill-history.js  # (one-off; refuses if a history exists locally or in the bucket) seeds data/price-history.json from git
node --env-file=.env record-history.js  # records the catalog -> data/price-history.json, history-public.json, movers.json
node scrape-cf-vanguard.js            # cf-vanguard reference -> data/cf-vanguard-raw.json
node scrape-card-detail.js            # (optional, slow) JP skill text -> data/card-details-raw.json
node scrape-card-detail.js --missing  # (optional) only the cards still missing text, ~15 min
node scrape-set.js <slug>             # (optional) refresh one set in catalog-raw.json; the history records it at the next full scrape
node scrape-fandom.js                 # (occasional) wiki fan translations, all series -> data/fandom-raw.json
node scrape-fandom.js --series V,G    # ... only some series (D,DZ,V,G,OLD); merged into the existing file, other series are kept
node build-data.js                    # writes data/cards.json, data/catalog.json, data/details/<set>.json
node --env-file=.env upload-cards.js  # uploads the history files, changed shards, catalog.json + cards.json to Supabase Storage
npm test                              # unit tests for the history/run-gate rules
```

### `frontend/`

Vite + React static site — `npm install && npm run dev` (or `npm run build`). It fetches the slim card catalog from `/api/catalog`, a card's skill text/flavor/stats from `/api/details/<set>` when its popup opens, and the price history / market movers from `/api/history` and `/api/movers` (lazily, on first card-modal open or Movers visit). These are Vercel Functions (`frontend/api/catalog.js`, `details/[set].js`, `history.js`, `movers.js`, plus the legacy `cards.js`) that proxy the private Supabase bucket so the S3 credentials never reach the browser, and they only serve an allowlist (`catalog.json`, `cards.json`, `details/<slug>.json` for lowercase-alphanumeric/hyphen slugs, `history-public.json`, `movers.json`); those credentials go in `frontend/.env.local` for local dev (see `pipeline/.env.example` for the variable names) and as Vercel project env vars in production. For local dev without credentials, set `LOCAL_DATA_DIR=../pipeline/data` to serve the routes from local files instead.

## Data licensing note

Card data and images are hotlinked/derived from yuyu-tei.jp and cf-vanguard.com for personal/fan reference use. Fan-translated names and card text come from the [Cardfight!! Vanguard Wiki](https://cardfight.fandom.com) under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/); each card's popup links its source page. This is an unofficial fan tool, not affiliated with either site.
