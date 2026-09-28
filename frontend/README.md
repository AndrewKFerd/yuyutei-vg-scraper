# frontend

Vite + React + Tailwind site. Card data lives in a private Supabase Storage bucket (written by `../pipeline/`) and reaches the browser only through three same-origin Vercel Functions in `api/`, which hold the S3 credentials server-side:

| Route | Bucket object | What it is |
|---|---|---|
| `/api/cards` | `cards.json` | the full catalog (~30 MB), loaded on page load and cached for a day |
| `/api/history` | `history-public.json` | per-listing price/stock change history — fetched lazily (first card popup or Market Movers visit) |
| `/api/movers` | `movers.json` | precomputed 24h / 7d / 30d market movers — fetched when Market Movers opens |

Only those three keys can be served (allowlist in `api/_supabaseCards.js`); the private `price-history.json` never is. A missing object returns `404 {"error":"Not found"}`, which the site treats as "no history yet".

```
npm install
npm run dev     # http://localhost:5173 -- /api/* use the same handlers as production
npm run build   # -> dist/
npm run lint
```

Local dev needs data from one of:

- **Supabase:** `SUPABASE_S3_*` vars in `frontend/.env.local` (names in `../pipeline/.env.example`).
- **Local files, no credentials:** set `LOCAL_DATA_DIR` to a directory holding `cards.json`, `history-public.json` and `movers.json` (e.g. the pipeline's output) and `/api/*` serve those files instead:

  ```
  LOCAL_DATA_DIR=../pipeline/data npm run dev
  ```

  (PowerShell: `$env:LOCAL_DATA_DIR='../pipeline/data'; npm run dev`.) A missing file returns the same 404 as production.

URL state is shareable: `?card=dzbt14/10318` opens that card, `?view=movers&w=30d` opens Market Movers on the 30-day window.

See the repo root `README.md` for the full data pipeline / architecture.
