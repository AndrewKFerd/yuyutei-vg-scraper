// The shapes of the data the site passes around, as JSDoc types for the
// type checker (`npm run typecheck`, see jsconfig.json). Comments only:
// nothing here exists at runtime. Refer to them from JSDoc, e.g.
// `@param {import('../lib/types.js').Card} card`.
//
// Files written by the pipeline (catalog, shards, history, movers) are
// still checked at runtime where they're loaded -- these types describe
// what passes those checks, they don't replace them.

/**
 * One yuyu-tei listing from the slim catalog (/api/catalog), after
 * hydrateCards() has filled the derived fields back in. Written by
 * pipeline/catalog-split.js's slimCard().
 * @typedef {object} Card
 * @property {string} id  The listing id, "<set slug>/<number>" ("dzbt14/10318").
 * @property {string | null} setCode  The printed card number ("DZ-BT14/001").
 * @property {string} setSlug
 * @property {string | null} rarity
 * @property {string | null} nameJp
 * @property {string | null} nameEn
 * @property {'official' | 'fandom' | 'glossary' | 'romaji' | string} [translationSource]
 * @property {number | null} price  JPY.
 * @property {number | null} stock  0 = sold out; null = in stock, no count given.
 * @property {{ from: number, at: number }} [chg7d]  The price 7 days ago, and when it changed.
 * @property {string | string[]} [nation]  Nation code(s), for Market Movers.
 * @property {string | null} imageUrl
 * @property {string | null} detailUrl
 * @property {string | null} priceDisplay
 */

/**
 * The /api/catalog payload, as fetchCatalog() resolves it.
 * @typedef {object} CatalogPayload
 * @property {Card[]} cards
 * @property {string} generatedAt  ISO time the pipeline built it.
 * @property {string} [structHash]  Hash of everything but price/stock, to tell whether deltas can update it.
 * @property {number} count
 * @property {{ code: string, label: string, group?: string }[]} [nations]
 * @property {{ slug: string, code: string | null, name: string | null }[]} [sets]
 */

/** @typedef {'loading' | 'ready' | 'error'} CatalogStatus */

/**
 * A card's heavy fields, from its set's detail shard (/api/details/<set>).
 * Fields a card doesn't have are left out.
 * @typedef {object} DetailEntry
 * @property {string} [kind]  Japanese card type ("ノーマルユニット").
 * @property {string} [clan]  Japanese nation/clan.
 * @property {number} [grade]
 * @property {number} [power]
 * @property {number} [shield]
 * @property {string} [skillTextEn]
 * @property {string} [skillTextJp]
 * @property {string} [flavorEn]
 * @property {string} [flavorJp]
 * @property {string} [wikiTitle]
 */

/**
 * One price-history entry: [minute, price in JPY, stock] -- appended only
 * when price or stock changed. Minutes are since the Unix epoch.
 * @typedef {[number, number, number | null]} HistoryEntry
 */

/**
 * history-public.json (/api/history).
 * @typedef {object} History
 * @property {1} v
 * @property {number} trackingSince  Minute the first run recorded.
 * @property {number} lastRun
 * @property {[number, number][]} coverage  Spans of runs that saw the catalog.
 * @property {Record<string, HistoryEntry[]>} cards  Only cards whose price changed.
 */

/**
 * movers.json (/api/movers): precomputed leaderboards per window.
 * @typedef {object} Movers
 * @property {1} v
 * @property {number} asOf
 * @property {Record<string, Record<string, any[]>>} windows  '24h' | '7d' | '30d' -> section -> entries.
 */

/**
 * A card in a saved list: a snapshot from when the list was saved (or
 * last refreshed).
 * @typedef {object} SavedItem
 * @property {string} id
 * @property {number} qty  1-99.
 * @property {number | null} price  JPY then.
 * @property {string | null} nameEn
 * @property {string | null} nameJp
 * @property {string | null} setCode
 * @property {string | null} rarity
 */

/**
 * A saved list (localStorage `yuyutei:saved-lists`). Times in ms.
 * @typedef {object} SavedList
 * @property {string} id
 * @property {string} name
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {number} pricedAt  When the items' prices were taken.
 * @property {SavedItem[]} items
 */

/**
 * A price and stock, and the minute they're known to be from.
 * @typedef {{ price: number | null, stock: number | null, at: number }} PriceState
 */

/**
 * A watched card (localStorage `yuyutei:watchlist`). `seen` is the price
 * and stock as last looked at: what "since you last looked" compares
 * against. Times are minutes.
 * @typedef {object} WatchItem
 * @property {string} id
 * @property {number} addedAt
 * @property {number | null} target  JPY. Reaching it, in stock, is a change worth showing.
 * @property {PriceState} seen
 * @property {{ nameEn: string | null, nameJp: string | null, setCode: string | null, rarity: string | null }} snap
 *   Names from when it was added, for a card no longer in the catalog.
 */

/**
 * A price list (calculator) line as stored: the card, how many, and a
 * snapshot for when the catalog doesn't have it.
 * @typedef {object} CalcItem
 * @property {string} id
 * @property {number} qty
 * @property {number} at  ms the snapshot's price/stock is from.
 * @property {{ price: number | null, stock: number | null, nameEn: string | null, nameJp: string | null,
 *   setCode: string | null, rarity: string | null, imageUrl: string | null, detailUrl: string | null }} snap
 */

export {}
