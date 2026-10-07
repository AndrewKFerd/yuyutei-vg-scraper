# pipeline

The offline half of the project: scrapes yuyu-tei.jp (prices, stock, Japanese
card text), cf-vanguard.com (official English names/text) and the Cardfight!!
Vanguard Wiki (fan translations), translates card names, records the price
history, and uploads the result to the private Supabase bucket the frontend
reads through its Vercel Functions.

**The root [`README.md`](../README.md) is the reference**: architecture, the
catalog split, every safety gate and its override, how the scheduled refresh
works. This file only maps the directory.

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
| `scrape-catalog.js` | yuyu-tei's global VG search, every set's listings | `catalog-raw.json` |
| `scrape-set.js <slug>` | refresh one set inside `catalog-raw.json` | |
| `scrape-cf-vanguard.js` | official English database (names, stats, skill text); keeps the old file if the scrape is incomplete (`reference-gate.js`) | `cf-vanguard-raw.json` |
| `scrape-card-detail.js` | per-card yuyu-tei detail page: Japanese skill text. Slow, resumable; `--missing` retries only cards that could still gain text | `card-details-raw.json` (committed) |
| `scrape-fandom.js` | wiki fan translations; `--series D,DZ,V,G,OLD`, `--limit`/`--out` for samples | `fandom-raw.json` (committed) |
| `record-history.js` | appends this run to the price history; holds the run gates | `price-history.json`, `history-public.json`, `movers.json` |
| `backfill-history.js` | one-off seeding of the history from git snapshots | |
| `build-data.js` | joins everything into the served files | `cards.json`, `catalog.json`, `details/<set>.json` |
| `upload-cards.js` | uploads to the bucket (changed detail shards only) | `upload-manifest.json` |
| `refresh-and-push.ps1` | the scheduled run: catalog -> history -> cf-vanguard (at most daily) -> build -> upload | `refresh.log` |

Run any of the Node scripts from this directory, e.g. `node build-data.js`;
the ones that touch the bucket need `node --env-file=.env <script>`.

## Modules

`http-client.js` (browser-like headers, cookie jar, 30 s request timeout),
`s3.js` (bucket client with timeouts), `fs-atomic.js` (crash-safe writes),
`catalog-gate.js` / `reference-gate.js` (the size/loss gates),
`price-history.js` (history format, `chg7d`, movers), `catalog-split.js` (the
slim catalog and detail shards), `match-official.js` / `match-fandom.js` /
`fandom-series.js` / `translate-engine.js` + `data/glossary.json` (name
sources, in that order of preference), `card-group.js` (one key per card across
foil/parallel variants).

`CF_VANGUARD_NOTES.md` records how cf-vanguard set codes map to yuyu-tei's.
