# cf-vanguard.com official-name matching — findings

## 1. Site structure

`https://en.cf-vanguard.com/cardlist/cardsearch/` is a WordPress page, not a
JSON API. There is no Japanese-name field anywhere on the site — it is a
pure-English database, exactly as the task description said.

- The initial page (`/cardlist/cardsearch/?...&view=image|text`) is
  server-rendered HTML containing the first ~24 results plus a small
  `<script>` block with `var max_page = N;` (the total page count for the
  current filter) and the "`<N> Results`" count.
- Scrolling further calls an AJAX endpoint,
  `/cardlist/cardsearch_ex/?...&view=image|text&page=<n>&t=<timestamp>`
  (`page` starting at 2 — page 1's results are already in the initial HTML),
  which returns a bare `<li>...</li>` HTML fragment to append. This is a real
  pagination mechanism, not an infinite-scroll illusion — `page` is a normal
  query param and works with a plain `fetch`/`curl`, no browser/JS needed.
- `view=image` ("Gallery View") gives only the card image, name (as `alt`/
  `title`), and its code (embedded in the `<a href>`'s `cardno=` query
  param). `view=text` ("List Detail View") returns the *same* per-card `<li>`
  shape but additionally includes the card number, full rules text, and a
  `Kind｜Nation/Clan｜Grade N｜Power N｜Shield N` status line. We use
  `view=text` throughout — same request/page cost, strictly more data (this
  is how we get clan/nation without extra requests).
- The unfiltered `regulation=D` (current Standard) listing is **12,765
  results across 532 pages of 24 cards/page**, confirming the pre-verified
  fact in the task. We did not crawl this whole thing (see §3).
- Very useful discovery: the `keyword=` search parameter matches against
  card **numbers**, not just names/rules text. `keyword=D-BT01` reliably
  scopes results to exactly one booster set's cards (verified: 213 results,
  `max_page=9`, `9*24=216≥213`, and every returned `cardno` did start with
  `D-BT01/`). This lets us scrape one set at a time via a normal search
  instead of crawling the global 532-page list and filtering client-side.

## 2. Does JP-setCode ↔ EN-cardno correlation hold?

**Short answer: yes, but not via the transformation the task description
hypothesized ("strip the leading Z"). The correct rule is simpler: take the
yuyu-tei JP setCode exactly as-is and append the literal suffix `EN`.**

### The "strip the Z" hypothesis is actively wrong

The task suggested checking whether stripping `DZ-BTxx` down to `D-BTxx`
lines up with English `D-BTxx` codes. We tested this against real scraped
data from both yuyu-tei (JP) and cf-vanguard (EN) and it does **not** hold —
because `D-BTxx` and `DZ-BTxx` are two different, unrelated Japanese product
lines that both start numbering at 01:

- `D-BTxx` = the older "Will+Dress / overDress" era (yuyu-tei confirms sets
  `D-BT01` through `D-BT13` exist, then the JP naming resets)
- `DZ-BTxx` = the current "Divinez" era (`DZ-BT01` through `DZ-BT16` as of
  this scrape — DZ-BT16 is the set our 247-card sample file is from)

Concrete proof these are different cards, not the same card under two
spellings:

| Code | JP name | Would-be EN match if you strip Z |
|---|---|---|
| `D-BT01/DSR01` (JP) | トリクスタ ("Trickstar") | — |
| `DZ-BT01/DSR01` (JP) | 奇跡の運命者 レザエル ("Fated One of Miracles, Rezael") | — |
| `D-BT01/DSR01EN` (actual EN card at that code) | **Trickstar** | matches `D-BT01`, NOT `DZ-BT01` |

If you stripped the `Z` from `DZ-BT01/DSR01` you'd land on `D-BT01/DSR01EN`
("Trickstar") and wrongly present it as the official name for "Fated One of
Miracles, Rezael." That is exactly the kind of confident-looking wrong match
the task asked us to avoid. **The matcher does not strip anything.**

### The rule that does hold: exact code + "EN" suffix

Once you compare each JP family against its OWN English family (not the
other one), the correlation is exact — same set number, same rarity-code
scheme, same per-code card identity:

**D-BT01 (old era), verified card-for-card:**

| yuyu-tei code | yuyu-tei nameJp | cf-vanguard code | cf-vanguard nameEn |
|---|---|---|---|
| `D-BT01/001` | ヴェルリーナ・バリエンテ | `D-BT01/001EN` | Vairina Valiente |
| `D-BT01/013` | 再起の竜神王 ドラグヴェーダ | `D-BT01/013EN` | Dragon Deity King of Resurgence, Dragveda |
| `D-BT01/DSR01` | トリクスタ(箔押し) | `D-BT01/DSR01EN` | Trickstar |

**D-BT08 (spot check, different set), verified:**

| yuyu-tei code | yuyu-tei nameJp | cf-vanguard code | cf-vanguard nameEn |
|---|---|---|---|
| `D-BT08/001` | 粋の極致 忍鬼 猩々童子 | `D-BT08/001EN` | Peak Personage Stealth Rogue, Shojodoji |
| `D-BT08/013` | レディースアンドジェントルマン！ ララミ | `D-BT08/013EN` | Ladies and Gentlemen! Rarami |

**DZ-BT01 (current era, checked against its own EN release), verified:**

| yuyu-tei code | yuyu-tei nameJp | cf-vanguard code | cf-vanguard nameEn |
|---|---|---|---|
| `DZ-BT01/001` | 無双の運命者 ヴァルガ・ドラグレス | `DZ-BT01/001EN` | Fated One of Unparalleled, Varga Dragres |
| `DZ-BT01/019` | 再起の竜神王 ドラグヴェーダ | `DZ-BT01/019EN` | Dragon Deity King of Resurgence, Dragveda |

(Note `DZ-BT01/019` above coincidentally shares the JP name "再起の竜神王
ドラグヴェーダ" with `D-BT01/013` — Vanguard reuses/reprints characters
across product lines/reboots under different card numbers. This is exactly
why per-family, exact-code matching is required and cross-family number
matching is not safe.)

Every one of the ~213–260 codes we spot-checked per set (numbered cards,
plus the `DSR`/`H`/`SP`/`T` alt-print codes for D-BT, `DSR`/`FR`/`FFR`/`SR`/
`SEC`/`T` for DZ-BT) followed this pattern with no exceptions found.

### Where the correlation runs out: release lag, not scheme mismatch

- JP `D-BTxx` exists for 01–13, then the JP naming switches to `DZ-BTxx`.
  EN `D-BTxx` also stops at 13 (EN never got further because JP itself
  moved on to the new naming scheme) — consistent, not a coincidence.
- JP `DZ-BTxx` is currently up to **DZ-BT16** (our 247-card sample set).
  EN `DZ-BTxx` currently tops out at **DZ-BT15** — one full set behind.
  `DZ-BT16` has **zero** English results (`0 Results` for a
  `keyword=DZ-BT16` search). So every card in the sample file legitimately
  has no official English name yet — this is expected, not a matcher bug.
- EN sometimes adds extra alt-art codes with no JP equivalent at all (we
  found `DZ-BT01/EX01EN`...`EX41EN` and `EXS01EN`...`EXS10EN` — English-
  exclusive showcase arts not present under those codes in the JP listing).
  These simply never get looked up by the matcher (nothing on the yuyu-tei
  side would query for `EX`-series codes), so they're harmless.
- We only verified this exact-code rule for the `D-BTxx` and `DZ-BTxx`
  booster-set families. We did NOT verify it for structure decks (`D-SD`,
  `DZ-...SD`), trial decks (`D-TD`, `DZ-TD` — which we noticed have
  `-R`/`-T` reprint-variant suffixes after the `EN` that we haven't examined
  closely), or any promo/event code (`BCSxxxx`, `BROxxxx`, etc.). The
  scraper still collects `D-SD`/`D-TD`/`DZ-TD` data (cheap, and might be
  useful to another agent or a future extension), but **`match-official.js`
  refuses to return a match for any set-code family other than `D-BTxx` /
  `DZ-BTxx`**, since that's all we've actually confirmed.

## 3. Scrape scope & politeness

Rather than crawling the unfiltered 532-page/12,765-result listing (mostly
one-off promo/event codes with no yuyu-tei counterpart worth matching), the
scraper uses the `keyword=` search to fetch one booster/structure/trial-deck
set at a time, discovered by probing set numbers `01, 02, ...` per family
until a set returns `0 Results`:

- `D-BT01`–`D-BT13` (13 sets, old era — fully verified)
- `DZ-BT01`–`DZ-BT15` (15 sets, current era — fully verified, one set behind JP)
- `D-SD`, `D-TD`, `DZ-TD` structure/trial decks (collected but not trusted by the matcher)

Politeness: 400ms delay between every HTTP request (probe requests and page
fetches alike), 2 retries with backoff on failure. A hard ceiling of
`MAX_TOTAL_REQUESTS = 700` HTTP requests for the whole run bounds worst-case
runtime — at the actual family/set sizes above this finishes well under
that ceiling (~28 sets × ~10 pages/set + ~35 probe requests ≈ 300-350
requests), in a few minutes.

## 4. What `match-official.js` actually does

```js
findOfficialName(setCode, nameJp)
```

1. Rejects anything whose setCode family isn't exactly `D-BTxx` or
   `DZ-BTxx` (case-insensitive) — returns `null` immediately. This is the
   conservative guardrail: we only trust families we've verified.
2. Looks up `${setCode}EN` (uppercased) against an index built from
   `data/cf-vanguard-raw.json` (keyed by each scraped `cfCode` with its
   trailing `EN` stripped back off, so the lookup key format matches
   yuyu-tei's own setCode format exactly).
3. On a hit: `{ nameEn, confidence: 'high', cfCode }`. On a miss (most
   common — either the set hasn't been released in English yet, or that
   specific rarity/print wasn't scraped/doesn't exist in EN): `null`.
4. `nameJp` is accepted but not used to verify the match — cf-vanguard has
   no Japanese text to compare it against, and we deliberately don't
   attempt any transliteration/back-translation heuristic here (that would
   be manufacturing false confidence, exactly what the task warned against).
   It's kept in the signature so callers have a stable interface and so a
   future revision could use it for logging/sanity-checking.
5. Only ever returns `'high'` confidence. We found no verified basis for a
   `'medium'`-confidence heuristic that wouldn't risk false positives (e.g.
   guessing that a foil/parallel code maps to the same card as its base
   numbered printing turned out to NOT be a safe assumption once checked —
   D-BT01's `H01`–`H50` codes do NOT mirror the same numbers as `001`–`120`;
   they're a separately-numbered subset), so we did not ship one.

## 5. Real expected match rate

Against the 247-card `backend/data/cards-dzbt16.json` sample specifically:
**0 matches, expected and correct.** Every card in that file is
`DZ-BT16/...`, and DZ-BT16 has no English release at all yet (English is
one Divinez-era set behind). This is the single most important caveat for
whoever consumes this matcher: **it will currently match essentially 0% of
the newest/current-format Japanese set**, precisely because that's the set
still furthest from an English release. Match rate is inversely related to
"how current/in-format the card is" — the opposite of what you might
naively expect.

Rough overall expectations for yuyu-tei's full catalog:

- **Older `D-BT01`–`D-BT13` stock** (still sold on yuyu-tei as used
  singles even though out of the current Standard rotation): high match
  rate for the base numbered cards and the alt-print codes we scraped
  (`DSR`/`H`/`SP`/`T`) — likely 70-90% of cards actually present in both
  scrapes, since the correlation is exact wherever both sides have data.
- **`DZ-BT01`–`DZ-BT15` stock**: similarly high match rate for cards that
  exist in both scrapes.
- **`DZ-BT16` (and anything newer/future)**: ~0% until English catches up.
- **Secret rare / foil / parallel variants** in general: matches only when
  cf-vanguard happens to carry that exact rarity code (many parallels are
  Japan-exclusive print runs with no English counterpart at all — expect a
  meaningfully lower match rate for `SEC`/`FFR`/`GR`-style ultra-rare codes
  than for common numbered cards).
- **Structure decks, trial decks, promo/event cards**: 0%, by design — not
  attempted, since we haven't verified the code scheme for those products.

Net: expect the matcher to be genuinely useful for older/back-catalog
booster stock, and to correctly abstain (return `null`, falling back to the
glossary/MT engine) for anything from the newest set or from an
unverified product line. This is intentional — the task explicitly asked
for precision over recall, and an honest "we don't know yet" is the correct
answer for the newest set until cf-vanguard's English release catches up.

### Real measurements, not just spot checks

- **`backend/data/cards-dzbt16.json` (247 cards, the task's test fixture):
  0/247 matched.** Every card is `DZ-BT16/...`, and DZ-BT16 has no English
  release at all (confirmed: `keyword=DZ-BT16` on cf-vanguard returns `0
  Results`; the newest EN Divinez set is DZ-BT15). This is the correct,
  expected answer, not a bug — see the "one set behind" point above.
- **DZ-BT05 (an older, already-localized current-era set), independently
  re-scraped from yuyu-tei live and run through `findOfficialName` as a
  sanity check: 240/277 JP cards (~87%) got a confident match.** All 37
  misses were `DZ-BT05/EX##` codes — English-exclusive-numbering showcase
  alt-arts that, per our own cf-vanguard scrape, EN has not released at all
  for this set (0 `EX`-coded cards scraped for `DZ-BT05` on the English
  side) — i.e. every single miss is a legitimately correct "no match," not
  a false negative. This is a good proxy for what to expect on any
  already-localized set: very high recall on the base numbered cards and
  mainstream rarities (`SEC`/`SR`/`FR`/`FFR`/`RRR`/`RR`/`R`/`C`), with the
  gap concentrated entirely in extra showcase/alt-art print runs.
