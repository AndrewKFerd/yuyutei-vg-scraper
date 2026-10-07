# yuyutei-vg-scraper

An English search site for [yuyu-tei.jp](https://yuyu-tei.jp)'s full Cardfight!! Vanguard singles catalog: about 28,000 cards with prices, stock, English names and card text.

**Live site:** https://yuyutei-vg-scraper.vercel.app

## What it does

- **Search** every card by English or Japanese name, set code or rarity, and filter by set and rarity.
- **Card popup** with the card's text, a price/stock history chart, and a link to yuyu-tei.
- **Market Movers**: biggest risers and drops, sold out, back in stock and selling fast, over 24 hours, 7 days or 30 days. Filter by nation and minimum price.
- **Prices in other currencies** and a light/dark theme.

English names come from the official English card database where a card has been released in English, otherwise from the Cardfight!! Vanguard Wiki's fan translations, otherwise from a built-in Japanese-to-English name translator.

## How it works

```
 yuyu-tei.jp ─┐
 cf-vanguard ─┼─► pipeline/ (runs on this PC every 30 min) ─► private Supabase bucket
 fandom wiki ─┘                                                       │
                                                                      ▼
                                   frontend/ (Vercel) ◄── small /api/* proxy functions
```

- **`pipeline/`** scrapes the sites, translates names, records the price history and uploads the results.
- **`frontend/`** is the website (Vite + React + Tailwind). It downloads the card list once, then searches and filters everything in the browser.

The pipeline runs locally rather than in the cloud because yuyu-tei blocks cloud servers.

## Running it

**The website, locally:**
```
cd frontend
npm install
LOCAL_DATA_DIR=../pipeline/data npm run dev
```
This serves the data from your local `pipeline/data` folder. To use the real bucket instead, put the `SUPABASE_S3_*` keys in `frontend/.env.local`.

**The data refresh** runs on its own through Windows Task Scheduler (task `YuyuteiPriceRefresh`, every 30 minutes), using `pipeline/refresh-and-push.ps1`. Each run takes a few minutes and writes to `pipeline/refresh.log`. Data updates go straight to the bucket, so no redeploy is needed. Code changes deploy when you push to `main`.

**Occasional manual jobs** (from `pipeline/`):

| Command | When |
|---|---|
| `node scrape-fandom.js` | Now and then, to pick up new wiki fan translations (~30 min) |
| `node scrape-card-detail.js --missing` | Now and then, to fill in cards still missing Japanese card text (~15 min) |
| `npm test` | After changing pipeline code |

Commit `pipeline/data/fandom-raw.json` and `card-details-raw.json` afterwards. They are slow to rebuild, so they live in git.

## When a refresh stops itself

The refresh refuses to publish data that looks broken, for example a scrape that came back much smaller than usual. When that happens, `refresh.log` shows the reason and nothing is uploaded. If the change is real, rerun once with the matching switch:

| Log says... | Rerun with |
|---|---|
| Catalog shrank by more than 2% | `ALLOW_CATALOG_SHRINK=1` |
| Too many prices changed at once | `ALLOW_MASS_CHANGE=1` |
| Official English names would be lost | `ALLOW_OFFICIAL_SHRINK=1` |
| Local price history is smaller than the bucket's | `FORCE_HISTORY_UPLOAD=1` |

The full list, plus how the lock, timeouts and uploads behave, is in [`pipeline/README.md`](pipeline/README.md).

The price history is the one thing that can't be regenerated. The bucket keeps a copy, and `pipeline/data/history-backups/` keeps 14 daily copies.

## Credits and licensing

Card data and images come from yuyu-tei.jp and cf-vanguard.com, for personal fan reference. Fan translations come from the [Cardfight!! Vanguard Wiki](https://cardfight.fandom.com) under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), and each card's popup links its source page. This is an unofficial fan tool, not affiliated with any of these sites.
