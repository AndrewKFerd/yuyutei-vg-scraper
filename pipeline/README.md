# pipeline

The offline half of the project: scrapes yuyu-tei.jp (prices, stock, Japanese
card text), cf-vanguard.com (official English names/text) and the Cardfight!!
Vanguard Wiki (fan translations), translates card names, records the price
history, and uploads the result to the private Supabase bucket the frontend
reads through its Vercel Functions. The root [`README.md`](../README.md) is the
short overview; this file is the technical reference.

## Setup

```
cd pipeline
npm install
cp .env.example .env     # SUPABASE_S3_* -- only needed for history/upload steps
npm test                 # node --test
```

## Scripts

| Script | What it does | Output (in `data/`) |
|---|---|---|
| `scrape-catalog.js` | yuyu-tei's global VG search, every set's listings (~28k cards, 300+ sets), plus the shop's set list (names, newest first) off page 1 | `catalog-raw.json` |
| `scrape-set.js <slug>` | refresh one set inside `catalog-raw.json` | |
| `scrape-cf-vanguard.js` | official English database (names, stats, skill text) for JP set codes with a verified English release | `cf-vanguard-raw.json` |
| `scrape-card-detail.js` | per-card yuyu-tei detail page: Japanese skill text. Slow (~28k requests), resumable, always merges into the existing file | `card-details-raw.json` (committed) |
| `scrape-fandom.js` | wiki fan names/text/flavor via the MediaWiki API (~820 requests, ~25-30 min) | `fandom-raw.json` (committed) |
| `record-history.js` | appends this run to the price history; holds the run gates | `price-history.json`, `history-public.json`, `movers.json` |
| `backfill-history.js` | one-off seeding of the history from the Sep 15-18 2026 `cards.json` snapshots in git | `price-history.json` |
| `build-data.js` | joins everything into the served files | `cards.json`, `catalog.json`, `details/<set>.json` |
| `upload-cards.js` | uploads to the bucket (changed detail shards only) | `upload-manifest.json` |
| `refresh-and-push.ps1` | the scheduled run (below) | `refresh.log` |

Name/text precedence in `build-data.js`: official English first, then the wiki
fan translation, then `translate-engine.js` (a zero-network glossary +
romanization engine) with the scraped Japanese skill text.

Running by hand:
```
npm run scrape                            # catalog -> data/catalog-raw.json
node --env-file=.env record-history.js    # -> price-history.json, history-public.json, movers.json
node scrape-cf-vanguard.js                # -> cf-vanguard-raw.json
node scrape-card-detail.js --missing      # only cards still missing text (~785, ~15 min)
node scrape-fandom.js                     # all series -> fandom-raw.json
node scrape-fandom.js --series V,G        # only some series (D,DZ,V,G,OLD), merged into the existing file
node scrape-fandom.js --limit 1 --out /tmp/sample.json   # small sample, leaves fandom-raw.json alone
node build-data.js                        # -> cards.json, catalog.json, details/
node --env-file=.env upload-cards.js      # -> bucket
node --env-file=.env backfill-history.js  # one-off; refuses if a history exists locally or in the bucket
```

## The scheduled run

`refresh-and-push.ps1`, started every 30 minutes by the Task Scheduler task
`YuyuteiPriceRefresh` (via `run-refresh-task-hidden.vbs` -> `run-refresh-task.cmd`),
runs: catalog -> history -> cf-vanguard -> build -> upload. It runs locally
because yuyu-tei hard-blocks GitHub's runner IPs.

- **History straight after the catalog**, so a bad scrape is caught by the run
  gates before the slow steps.
- **cf-vanguard at most daily**: skipped while `cf-vanguard-raw.json` is under
  20 h old (`FORCE_CF_VANGUARD=1` forces it). A rejected scrape keeps the old
  file and its old timestamp, so the next run retries.
- **Not run automatically**: `scrape-fandom.js` and `scrape-card-detail.js`
  (slow, manual).
- **Lock** (`refresh.lock`, decision logic in `refresh-lock.ps1`, tested by
  `test/refresh-lock.test.ps1`): stores the owner's PID and start time. A live
  owner is never taken over, however old the lock. A gone owner or a reused PID
  is taken over. An owner whose start time can't be read (another elevation
  level) is judged by process name: not PowerShell means gone; PowerShell means
  skip with a warning. A verified owner still running after 3 h is presumed hung,
  killed with `taskkill /T /F`, and the lock is taken over only once it's gone.
  Backstop: the task is set to "do not start a new instance" and "stop after 2 h".
- **Timeouts**: 60 s per HTTP request; S3 15 s to connect, 120 s idle, 15 min overall.
- **Log**: `refresh.log`, rotated to `refresh.old.log` past 5 MB.

To rerun with an override: `$env:ALLOW_CATALOG_SHRINK='1'; .\refresh-and-push.ps1`
(PowerShell, from this directory; the variable lasts for that window only).

## Safety gates

Each exits 1, which aborts the scheduled run before anything is recorded or
uploaded, except the cf-vanguard one, which keeps the previous file and lets the
run continue.

| Gate | Where | Override |
|---|---|---|
| cf-vanguard scrape incomplete (a set parsed fewer cards than reported, a family cut short) or >2% smaller than the last one: keeps the previous file | `scrape-cf-vanguard.js` | `ALLOW_OFFICIAL_SHRINK=1` |
| Over 2% of listings that had an official English name would lose it | `build-data.js` | `ALLOW_OFFICIAL_SHRINK=1` |
| Catalog empty, or >2% smaller than the largest run of the last 7 days (one skipped page is ~2%) | `record-history.js`, `build-data.js` | `ALLOW_CATALOG_SHRINK=1` (also resets the baseline) |
| Catalog looks misread: <90% of listings have a price, or >25% of listings changed at once | `record-history.js` | `ALLOW_MASS_CHANGE=1` |
| No price history locally or in the bucket | `record-history.js` | `HISTORY_INIT=1` (only after the bucket was checked) |
| Local `price-history.json` under 90% of the bucket's copy: nothing is uploaded | `upload-cards.js` | `FORCE_HISTORY_UPLOAD=1` |
| Backfilling while a history exists, or without credentials | `backfill-history.js` | `--force` / `--force-remote` / `--no-remote-check` |

## Price history

`price-history.json` is a change log: a listing gets a new `[minute, price, stock]`
entry only when something changed. From it, `record-history.js` writes the
served `history-public.json` (card charts) and `movers.json`. It is the one file
that can't be regenerated: a missing local copy is restored from the bucket, and
there are local backups in `price-history.prev.json` and `history-backups/`
(one per day, newest 14). It never starts an empty history silently.

## Served files and uploads

- **`catalog.json`**: the slim catalog for the grid, search, filters and
  Market Movers (id, set, rarity, names, translationSource, price, stock,
  chg7d, nation; ~6 MB raw, ~0.6 MB brotli). `imageUrl`, `detailUrl` and
  `priceDisplay` are dropped when they follow from the id/price
  (`frontend/src/catalogFormat.js` rebuilds them). It also carries the nation
  list (`nation.js` maps D-era nations and classic clans to nations) and the
  set filter's list, `sets`: `{ slug, code, name }` in the shop's order, with
  the official code ("D-BT08") read off the cards and yuyu-tei's set name.
- **`details/<set>.json`**: one file per set (~300) with each card's skill text,
  flavor, kind/clan/grade/power/shield and wiki title, loaded when a card opens.
- **`cards.json`**: the full ~30 MB file. It's still built because
  `build-data.js`'s official-name gate compares against it. It's still
  uploaded too, but nothing serves it any more: the `/api/cards` route is
  gone (the file was too big to edge-cache, so every request cost a full
  Supabase download). The upload can be dropped from `upload-cards.js`.

`upload-cards.js` uploads the history files, then the detail shards, then
`catalog.json`, so the catalog never points at a missing shard. Each run lists
`details/` in the bucket and uploads only shards that are missing or whose ETag
differs from the local MD5 (`FORCE_SHARD_UPLOAD=1` sends all). Shards of sets
that have disappeared are deleted after 48 h orphaned, never more than a fifth
per run.

## Data files

Committed (slow to rebuild): `card-details-raw.json`, `fandom-raw.json`,
`glossary.json`. Everything else in `data/` is regenerated each run and
gitignored, including the history files (the bucket copy is their backup).

## Modules

`http-client.js` (browser-like headers, cookie jar, request timeout),
`s3.js` (bucket client with timeouts), `fs-atomic.js` (crash-safe writes),
`catalog-gate.js` / `reference-gate.js` (the size/loss gates),
`price-history.js` (history format, `chg7d`, movers), `catalog-split.js` (the
slim catalog and detail shards), `nation.js` (clan -> nation),
`match-official.js` / `match-fandom.js` / `fandom-series.js` /
`translate-engine.js` + `data/glossary.json` (name sources),
`card-group.js` (one key per card across foil/parallel variants).
`CF_VANGUARD_NOTES.md` records how cf-vanguard set codes map to yuyu-tei's.
