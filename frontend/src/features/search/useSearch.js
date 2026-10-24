import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { buildSetOptions } from '../../lib/sets'
import { sortCards } from '../../lib/sorting'

// Preferred display order for the rarity dropdown (rarest/most notable
// first); anything not listed here (yuyu-tei adds new codes over time) is
// appended afterward, alphabetically.
const RARITY_ORDER = ['SEC', 'SP', 'FFR', 'SR', 'RRR', 'RR', 'R', 'C']

// The catalog now spans the entire Vanguard card range (tens of thousands
// of rows), so we never render every matching card's <img> at once —
// results are sliced into fixed-size pages client-side. No virtualization
// library needed: plain slicing is simpler, has zero new dependencies, and
// is plenty fast since the expensive part (filtering the in-memory array)
// is already memoized separately from pagination.
const PAGE_SIZE = 50

// What resets the page number: a different search, filter or sort.
const filterKeyOf = (query, setSlug, rarity, sort) => JSON.stringify([query.trim().toLowerCase(), setSlug, rarity, sort])

/**
 * The search view's state -- text, set, rarity, sort and page, starting
 * from `initial` (readUrlState()) -- and the results it gives over `cards`.
 * `catalogSets` is the catalog's set list; filters the loaded catalog can't
 * satisfy are dropped once `catalogReady`.
 * @param {{ initial: ReturnType<typeof import('../../app/useUrlState').readUrlState>,
 *   cards: import('../../lib/types.js').Card[], catalogSets: import('../../lib/types.js').CatalogPayload['sets'],
 *   catalogReady: boolean }} options
 */
export function useSearch({ initial, cards, catalogSets, catalogReady }) {
  const [query, setQuery] = useState(initial.query)
  const [setSlug, setSetSlug] = useState(initial.setSlug) // '' = all sets
  const [rarity, setRarity] = useState(initial.rarity) // '' = all rarities
  const [sort, setSort] = useState(initial.sort)

  // Keeps the input snappy: the text state updates immediately on every
  // keystroke, while the (potentially expensive) filtered grid re-render
  // can lag a frame behind under React's control.
  const deferredQuery = useDeferredValue(query)

  // The set filter's options, newest first (see sets.js).
  const setOptions = useMemo(() => buildSetOptions(cards, catalogSets), [cards, catalogSets])
  const selectedSet = useMemo(() => setOptions.find((set) => set.slug === setSlug) || null, [setOptions, setSlug])

  // Cards narrowed to the selected set only (independent of the rarity
  // filter/search), so the rarity dropdown can reflect just what's actually
  // in that set instead of every rarity code in the whole catalog.
  const setScopedCards = useMemo(() => {
    if (!setSlug) return cards
    return cards.filter((card) => card.setSlug === setSlug)
  }, [cards, setSlug])

  // Each card's searchable fields, lowercased and joined once per catalog
  // load rather than re-lowercased on every keystroke (~4x faster per
  // keystroke across the full 28k-card catalog). "\n" can't appear in a
  // typed query, so a match can never straddle two fields.
  const searchText = useMemo(() => {
    const map = new Map()
    for (const card of cards) {
      map.set(
        card,
        [card.nameEn, card.nameJp, card.setCode, card.rarity].filter(Boolean).join('\n').toLowerCase()
      )
    }
    return map
  }, [cards])

  // Distinct rarities present in the selected set (or the whole catalog when
  // no set is picked), known ones first (in a sensible rarest-first order),
  // anything unrecognized appended after.
  const rarityOptions = useMemo(() => {
    const present = new Set()
    for (const card of setScopedCards) {
      if (card.rarity) present.add(card.rarity)
    }
    const known = RARITY_ORDER.filter((r) => present.has(r))
    const unknown = Array.from(present)
      .filter((r) => !RARITY_ORDER.includes(r))
      .sort()
    return [...known, ...unknown]
  }, [setScopedCards])

  // Once the catalog is in, drop filters it can't satisfy -- a set or
  // rarity from an old or typo'd link, or a rarity the newly picked set
  // doesn't have -- rather than silently showing zero results. (Not while
  // loading: every list is empty then.)
  useEffect(() => {
    if (!catalogReady) return
    if (setSlug && !setOptions.some((set) => set.slug === setSlug)) setSetSlug('')
  }, [catalogReady, setOptions, setSlug])
  useEffect(() => {
    if (!catalogReady) return
    if (rarity && !rarityOptions.includes(rarity)) setRarity('')
  }, [catalogReady, rarityOptions, rarity])

  // Text search, the set filter, and the rarity filter all AND together.
  // All cheap linear scans over the in-memory array, and re-running this
  // only depends on the deferred (lagged) query plus the two filters, not
  // on pagination.
  const filteredCards = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    if (!q && !rarity) return setScopedCards
    return setScopedCards.filter(
      (card) => (!rarity || card.rarity === rarity) && (!q || searchText.get(card).includes(q))
    )
  }, [setScopedCards, searchText, deferredQuery, rarity])

  const sortedCards = useMemo(() => sortCards(filteredCards, sort), [filteredCards, sort])

  // The page number belongs to one search/filter/sort combination: change
  // any of them and you're back on page 1 (narrowing a search while on page
  // 40 would otherwise land on an empty page). Stored with the key it was
  // set under rather than reset by an effect, so a ?page= from a shared
  // link survives the first render.
  const filterKey = filterKeyOf(deferredQuery, setSlug, rarity, sort)
  const [pageState, setPageState] = useState(() => ({
    key: filterKeyOf(initial.query, initial.setSlug, initial.rarity, initial.sort),
    page: initial.page,
  }))
  const requestedPage = pageState.key === filterKey ? pageState.page : 1
  const setPage = useCallback((next) => setPageState({ key: filterKey, page: next }), [filterKey])

  // A single set tops out around 300-400 cards (vs. tens of thousands for
  // the whole catalog), so once one is picked there's no need to paginate --
  // show everything at once, grouped into per-rarity sections instead.
  const isSetSelected = setSlug !== ''

  const totalPages = Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE))
  const page = catalogReady ? Math.min(requestedPage, totalPages) : requestedPage
  const startIndex = (page - 1) * PAGE_SIZE
  const pageCards = useMemo(() => sortedCards.slice(startIndex, startIndex + PAGE_SIZE), [sortedCards, startIndex])

  // Group the (sorted) filtered cards by rarity, in the same rarest-first
  // order as the dropdown, for the sectioned single-set view. A rarity with
  // no cards left after the search/rarity filters narrowed things down just
  // doesn't get a section, rather than rendering an empty one. The sort
  // order carries through within each section.
  const raritySections = useMemo(() => {
    if (!isSetSelected) return []
    const byRarity = new Map()
    for (const card of sortedCards) {
      const key = card.rarity || ''
      if (!byRarity.has(key)) byRarity.set(key, [])
      byRarity.get(key).push(card)
    }
    const order = rarityOptions.length > 0 ? rarityOptions : Array.from(byRarity.keys())
    return order.filter((r) => byRarity.has(r)).map((r) => ({ rarity: r, cards: byRarity.get(r) }))
  }, [isSetSelected, sortedCards, rarityOptions])
  // The sections' cards in display order, for the modal's previous/next.
  const sectionCards = useMemo(() => raritySections.flatMap((s) => s.cards), [raritySections])

  const clearAll = useCallback(() => {
    setQuery('')
    setSetSlug('')
    setRarity('')
    setSort('default')
  }, [])

  return {
    query,
    setQuery,
    deferredQuery,
    setSlug,
    setSetSlug,
    rarity,
    setRarity,
    sort,
    setSort,
    clearAll,
    isFiltered: deferredQuery.trim().length > 0 || setSlug !== '' || rarity !== '',
    setOptions,
    selectedSet,
    rarityOptions,
    filteredCards,
    isSetSelected,
    page,
    totalPages,
    setPage,
    startIndex,
    pageCards,
    raritySections,
    sectionCards,
  }
}
