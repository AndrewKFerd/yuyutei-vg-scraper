# yuyutei-vg-scraper

An English-language, Gelbooru-style search UI over yuyu-tei.jp's entire Cardfight!! Vanguard singles catalog.

## Architecture

Data is generated **offline**, ahead of time, not fetched live at request time.
The built dataset lives in a **private** Supabase Storage bucket; the only
server-side piece in production is a single Vercel Function that proxies it.

```
pipeline/     -> scrapes yuyu-tei + cf-vanguard.com, translates card names,
                 writes pipeline/data/cards.json, uploads it to Supabase
                 Storage (private bucket -- see pipeline/upload-cards.js)
frontend/     -> Vite + React + Tailwind static site
frontend/api/ -> cards.js, a Vercel Function that proxies the private bucket
                 (holds the Supabase S3 credentials server-side; the browser
                 never sees them) -- the frontend fetches /api/cards and
                 renders/searches the result entirely client-side
```

### `pipeline/`

1. `scrape-catalog.js` — paginates yuyu-tei's global VG search endpoint and writes every set's card listings to `pipeline/data/catalog-raw.json` (~28k cards across 300+ sets).
2. `scrape-cf-vanguard.js` + `match-official.js` — scrapes the official English Cardfight!! Vanguard database and, where a card's JP set code has a verified English release, supplies its real official name plus its kind/clan/grade/power/shield and English skill text.
3. `scrape-card-detail.js` — fetches each card's own yuyu-tei detail page for its Japanese skill text, as a fallback for cards with no official English release yet. This is a per-card scrape (~28k requests) so it's slow (multiple hours) and resumable/checkpointed; run it as a separate, optional step. **Its selectors are unverified — see the file header before trusting a full run.**
4. `scrape-fandom.js` + `match-fandom.js` — pulls fan-translated English names, card text and flavor for D-/DZ- cards from the [Cardfight!! Vanguard Wiki](https://cardfight.fandom.com) via its MediaWiki API (~700 requests, ~10 min), matched by card code, then by Japanese name. Used for D-/DZ- cards with no official English release; the card popup credits and links the wiki page (the text is CC BY-SA). Manual, occasional step, since wiki text changes slowly.
5. `translate-engine.js` + `data/glossary.json` — a zero-network, deterministic JA→EN engine (hand-authored glossary + Hepburn romanization) used as the name fallback whenever there's no official English release yet.
6. `build-data.js` — combines the above (official name/skill text first, then the wiki fan translation for D-/DZ- cards, then the local engine + scraped JP skill text) into `pipeline/data/cards.json`.
7. `upload-cards.js` — uploads that file to the private Supabase Storage bucket, via its S3-compatible endpoint. Needs `SUPABASE_S3_*` env vars (see `.env.example`); run with `node --env-file=.env upload-cards.js`.

**This runs on its own**, via `refresh-and-push.ps1` on a recurring local Windows Task Scheduler job (see that file's header for why it's local-only and not a GitHub Actions cron: yuyu-tei hard-blocks GitHub's runner IPs). It scrapes, rebuilds `cards.json`, and uploads it straight to Supabase — no git commit, no Vercel redeploy needed for a data refresh; the live site just fetches fresh data through `/api/cards` (see below), subject to each visitor's own daily client-side cache. It also skips `scrape-fandom.js`, which reuses its last `data/fandom-raw.json` until you rerun it by hand. The other piece it deliberately skips is `scrape-card-detail.js` (see below) — its selectors are unverified and a full run takes hours, so it's a manual, occasional step.

The outputs of the two slow, manual scrapes — `data/card-details-raw.json` and `data/fandom-raw.json` — are committed, so a fresh clone (or another machine) can build immediately without redoing them. The others (`catalog-raw.json`, `cf-vanguard-raw.json`, `cards.json`) are regenerated on every refresh and stay gitignored.

To run any of it by hand (e.g. to test a pipeline change, or to run `scrape-card-detail.js`):
```
cd pipeline
npm install
npm run scrape                        # yuyu-tei catalog -> data/catalog-raw.json
node scrape-cf-vanguard.js            # cf-vanguard reference -> data/cf-vanguard-raw.json
node scrape-card-detail.js            # (optional, slow) JP skill text -> data/card-skills-raw.json
node scrape-fandom.js                 # (occasional) D-/DZ- fan translations -> data/fandom-raw.json
node build-data.js                    # writes data/cards.json
node --env-file=.env upload-cards.js  # uploads data/cards.json to Supabase Storage
```

### `frontend/`

Vite + React static site — `npm install && npm run dev` (or `npm run build`). It fetches card data from `/api/cards`, a Vercel Function (`frontend/api/cards.js`) that proxies the private Supabase bucket so the S3 credentials never reach the browser; those credentials go in `frontend/.env.local` for local dev (see `pipeline/.env.example` for the variable names) and as Vercel project env vars in production.

## Data licensing note

Card data and images are hotlinked/derived from yuyu-tei.jp and cf-vanguard.com for personal/fan reference use. Fan-translated names and card text for D-/DZ- cards come from the [Cardfight!! Vanguard Wiki](https://cardfight.fandom.com) under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/); each card's popup links its source page. This is an unofficial fan tool, not affiliated with either site.
