# pipeline/scrape-catalog.js

Scrapes yuyu-tei's full VG (Cardfight!! Vanguard) single-card sell catalog
using the site's global paginated search endpoint (returns cards from every
set at once, not just one), and writes the aggregated result to
`pipeline/data/catalog-raw.json`.

## Setup

```
cd pipeline
npm install
```

## Run

```
npm run scrape
```

or directly:

```
node scrape-catalog.js
```

The crawl walks `https://yuyu-tei.jp/sell/vg/s/search?search_word=&page=N`
starting at `page=1`, with a ~400ms politeness delay between requests, up to
200 pages (sanity ceiling). It stops as soon as a page returns zero
`div.card-product` elements. Failed page requests are retried up to twice
with backoff before being logged as a warning and skipped. Duplicate
`setSlug`+`id` combinations (can happen if pagination overlaps) are deduped,
keeping the first occurrence. Progress is logged every 10 pages.

A full run takes several minutes (currently ~47 pages). Output:

```
pipeline/data/catalog-raw.json
```

with shape:

```json
{
  "scrapedAt": "2026-09-15T13:49:22.609Z",
  "pagesScraped": 47,
  "count": 28199,
  "cards": [ { "id", "setCode", "setSlug", "rarity", "nameJp", "price", "priceDisplay", "stock", "imageUrl", "detailUrl" }, ... ]
}
```
