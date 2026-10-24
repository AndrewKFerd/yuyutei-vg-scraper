# frontend

Vite + React + Tailwind site. Card data lives in a private Supabase Storage bucket (written by `../pipeline/`) and reaches the browser only through same-origin Vercel Functions in `api/`, which hold the S3 credentials server-side:

| Route | Bucket object | What it is |
|---|---|---|
| `/api/catalog` | `catalog.json` | the slim catalog (~6 MB, ~0.6 MB compressed), loaded on page load and cached for an hour |
| `/api/details/<set>` | `details/<set>.json` | one set's skill text, flavor and stats — fetched when a card of that set is opened (`api/details/[set].js`; slug must match `[a-z0-9-]+`, else 400) |
| `/api/history` | `history-public.json` | per-listing price/stock change history — fetched lazily (first card popup or Market Movers visit) |
| `/api/movers` | `movers.json` | precomputed 24h / 7d / 30d market movers — fetched when Market Movers opens |

Only those keys can be served (allowlist in `api/_supabaseCards.js`); the private `price-history.json` never is. A missing object returns `404 {"error":"Not found"}`, which the site treats as "no history yet".

```
npm install
npm run dev     # http://localhost:5173 -- /api/* use the same handlers as production
npm run build   # -> dist/
npm run lint
npm test        # node --test: test/*.test.js
```

`src/` is grouped by what code is for: `app/` (the page shell, catalog loading, URL state), `features/<name>/` (search, card modal, movers, calculator, saved lists: each feature's components, hooks and logic together), `ui/` (shared components and class recipes), `data/` (fetching and caching the `/api/*` files) and `lib/` (pure helpers). `lib/`, `features/card/translate/` and the saved lists' `savedListsData.js` / `listTransfer.js` are also loaded straight into Node by the tests and the pipeline's translator scripts, so they import nothing from packages and keep `.js` on relative imports; `npm run lint` enforces both.

Local dev needs data from one of:

- **Supabase:** `SUPABASE_S3_*` vars in `frontend/.env.local` (names in `../pipeline/.env.example`).
- **Local files, no credentials:** set `LOCAL_DATA_DIR` to a directory holding `catalog.json`, `details/`, `history-public.json` and `movers.json` (and `cards.json` for the legacy route) (e.g. the pipeline's output) and `/api/*` serve those files instead:

  ```
  LOCAL_DATA_DIR=../pipeline/data npm run dev
  ```

  (PowerShell: `$env:LOCAL_DATA_DIR='../pipeline/data'; npm run dev`.) A missing file returns the same 404 as production.

URL state is shareable: `?card=dzbt14/10318` opens that card, `?view=movers&w=30d&nation=KS` opens Market Movers on the 30-day window, filtered to Keter Sanctuary.

See the repo root `README.md` for the full data pipeline / architecture.
