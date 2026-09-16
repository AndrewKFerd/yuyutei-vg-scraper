# yuyutei-vg-scraper

An English-language, Gelbooru-style search UI over yuyu-tei.jp's entire Cardfight!! Vanguard singles catalog.

## Architecture

Data is generated **offline**, ahead of time, not fetched live at request time. There is no backend server in production.

```
pipeline/  -> scrapes yuyu-tei + cf-vanguard.com, translates card names, writes
              frontend/public/data/cards.json
frontend/  -> Vite + React + Tailwind static site that reads that JSON file
              and renders/searches it entirely client-side
```

### `pipeline/`

1. `scrape-catalog.js` — paginates yuyu-tei's global VG search endpoint and writes every set's card listings to `pipeline/data/catalog-raw.json` (~28k cards across 300+ sets).
2. `scrape-cf-vanguard.js` + `match-official.js` — scrapes the official English Cardfight!! Vanguard database and, where a card's JP set code has a verified English release, supplies its real official name plus its kind/clan/grade/power/shield and English skill text.
3. `scrape-card-detail.js` — fetches each card's own yuyu-tei detail page for its Japanese skill text, as a fallback for cards with no official English release yet. This is a per-card scrape (~28k requests) so it's slow (multiple hours) and resumable/checkpointed; run it as a separate, optional step. **Its selectors are unverified — see the file header before trusting a full run.**
4. `translate-engine.js` + `data/glossary.json` — a zero-network, deterministic JA→EN engine (hand-authored glossary + Hepburn romanization) used as the name fallback whenever there's no official English release yet.
5. `build-data.js` — combines the above (official name/skill text first, local engine + scraped JP skill text as fallback) into `frontend/public/data/cards.json`.

Re-run the whole pipeline:
```
cd pipeline
npm install
npm run scrape                  # yuyu-tei catalog -> data/catalog-raw.json
node scrape-cf-vanguard.js      # cf-vanguard reference -> data/cf-vanguard-raw.json
node scrape-card-detail.js      # (optional, slow) JP skill text -> data/card-skills-raw.json
node build-data.js              # writes frontend/public/data/cards.json
```

### `frontend/`

Plain static site — `npm install && npm run dev` (or `npm run build`). No environment variables or backend needed; it just fetches `/data/cards.json` at the site root.

## Data licensing note

Card data and images are hotlinked/derived from yuyu-tei.jp and cf-vanguard.com for personal/fan reference use. This is an unofficial fan tool, not affiliated with either site.
