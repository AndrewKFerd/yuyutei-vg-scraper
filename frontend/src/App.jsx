import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { fetchCatalog, refreshCatalog } from './api'
import { getRates } from './currency'
import { DEFAULT_MOVER_WINDOW, MOVER_WINDOWS, pctChange } from './history'
import { applyTheme, getInitialTheme } from './theme'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import SetFilter from './components/SetFilter'
import RarityFilter from './components/RarityFilter'
import SortSelect from './components/SortSelect'
import CurrencySelector from './components/CurrencySelector'
import CardGrid from './components/CardGrid'
import RaritySections from './components/RaritySections'
import CardModal from './components/CardModal'
import MoversView, { DEFAULT_MIN_PRICE } from './components/MoversView'
import Pagination from './components/Pagination'
import Footer from './components/Footer'

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

// Sort step (SortSelect), applied to the filtered list before pagination /
// rarity sections. Array.prototype.sort is stable, so ties -- and every
// card a 7-day sort doesn't rank -- keep the default catalog order.
function sortCards(cards, sort) {
  if (sort === 'price-asc' || sort === 'price-desc') {
    const dir = sort === 'price-asc' ? 1 : -1
    return [...cards].sort((a, b) => {
      const aMissing = a.price == null
      const bMissing = b.price == null
      // Cards with no price sort last in both directions.
      if (aMissing || bMissing) return aMissing - bMissing
      return (a.price - b.price) * dir
    })
  }
  if (sort === 'rise-7d' || sort === 'drop-7d') {
    // chg7d is only present on listings whose price changed in the last 7
    // days (see pipeline/build-data.js) -- those moving the chosen way come
    // first by size of move, then everything else in default order.
    const wantUp = sort === 'rise-7d'
    const moved = []
    const rest = []
    for (const card of cards) {
      const pct = card.chg7d ? pctChange(card.chg7d.from, card.price) : null
      if (pct !== null && (wantUp ? pct > 0 : pct < 0)) moved.push({ card, pct })
      else rest.push(card)
    }
    moved.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    return [...moved.map((m) => m.card), ...rest]
  }
  return cards
}

// Shareable URL state, no router dependency: ?card=<id> opens that card's
// modal (once the catalog has loaded), ?view=movers selects the Market
// Movers tab, &w=24h|30d its window (the 7d default is left out) and
// &nation=<code> its nation filter (checked against the catalog's list once
// it has loaded).
function readUrlState() {
  const params = new URLSearchParams(window.location.search)
  const w = params.get('w')
  return {
    view: params.get('view') === 'movers' ? 'movers' : 'search',
    moversWindow: MOVER_WINDOWS.includes(w) ? w : DEFAULT_MOVER_WINDOW,
    moversNation: params.get('nation') || '',
    cardId: params.get('card') || null,
  }
}

const VIEWS = [
  ['search', 'Search'],
  ['movers', 'Market Movers'],
]

function ViewTabs({ view, onChange }) {
  return (
    <div className="flex justify-center px-4 pt-5">
      <div
        role="group"
        aria-label="View"
        className="inline-flex rounded-full border border-slate-300 bg-white p-1 shadow-sm dark:border-night-600 dark:bg-night-800"
      >
        {VIEWS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={view === key}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              view === key
                ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500 dark:text-night-950'
                : 'text-slate-600 hover:text-brand-700 dark:text-gold-500/80 dark:hover:text-brand-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function App() {
  const [cards, setCards] = useState([])
  const [meta, setMeta] = useState(null) // { generatedAt, count }
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [errorMessage, setErrorMessage] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  // Why the last "Refresh now" failed, shown next to the button; the
  // already-loaded catalog stays up either way.
  const [refreshError, setRefreshError] = useState('')
  const [query, setQuery] = useState('')
  const [setSlug, setSetSlug] = useState('') // '' = All Sets
  const [rarity, setRarity] = useState('') // '' = All Rarities
  const [page, setPage] = useState(1)
  const [currency, setCurrency] = useState('JPY')
  const [rates, setRates] = useState(null)
  const [selectedCard, setSelectedCard] = useState(null)
  const [theme, setTheme] = useState(getInitialTheme)
  const [sort, setSort] = useState('default')
  const [initialUrl] = useState(readUrlState)
  const [view, setView] = useState(initialUrl.view) // 'search' | 'movers'
  const [moversWindow, setMoversWindow] = useState(initialUrl.moversWindow)
  const [minPrice, setMinPrice] = useState(DEFAULT_MIN_PRICE)
  const [moversNation, setMoversNation] = useState(initialUrl.moversNation) // '' = all nations
  // [{code, label, group}] from the catalog; empty for one that predates it.
  const [nations, setNations] = useState([])
  // A ?card= deep link waits here until the catalog has loaded.
  const pendingCardIdRef = useRef(initialUrl.cardId)
  // Bumped after a manual refresh (which also drops the history/movers
  // caches) so the Movers view and card modal reload them.
  const [dataVersion, setDataVersion] = useState(0)

  // index.html already applied the initial theme before first paint; this
  // keeps <html> in sync whenever the user toggles it afterwards.
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  // Stable identity: CardModal's keydown/scroll-lock effect depends on it,
  // and an inline arrow would tear down and re-attach that effect on every
  // App render (i.e. every keystroke in the search box).
  const closeModal = useCallback(() => setSelectedCard(null), [])

  // Keeps the input snappy: the text state updates immediately on every
  // keystroke, while the (potentially expensive) filtered grid re-render
  // can lag a frame behind under React's control.
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    let cancelled = false

    setStatus('loading')
    fetchCatalog()
      .then((data) => {
        if (cancelled) return
        setCards(data.cards)
        setNations(Array.isArray(data.nations) ? data.nations : [])
        setMeta({ generatedAt: data.generatedAt, count: data.count, fromCache: data.fromCache })
        // Open a deep-linked card in the same render the grid appears in
        // (unknown ids are just ignored).
        const deepLinkId = pendingCardIdRef.current
        pendingCardIdRef.current = null
        if (deepLinkId) {
          const linked = data.cards.find((card) => card.id === deepLinkId)
          if (linked) setSelectedCard(linked)
        }
        setStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        setErrorMessage(err.message)
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Manual "get the latest data now" escape hatch — bypasses the daily
  // cache instead of waiting for it to expire on its own. A failure only
  // shows a note: the catalog already on screen (and in the cache) is
  // still good, so it stays.
  const handleRefresh = useCallback(() => {
    setIsRefreshing(true)
    setRefreshError('')
    refreshCatalog()
      .then((data) => {
        setCards(data.cards)
        setNations(Array.isArray(data.nations) ? data.nations : [])
        setMeta({ generatedAt: data.generatedAt, count: data.count, fromCache: data.fromCache })
        // The card modal can trigger this ("newer data than your cached
        // catalog"): swap the open card for its fresh copy so the modal
        // shows the new price/stock.
        setSelectedCard((prev) => (prev ? data.cards.find((card) => card.id === prev.id) || prev : prev))
        setDataVersion((v) => v + 1)
      })
      .catch((err) => setRefreshError(err.message))
      .finally(() => setIsRefreshing(false))
  }, [])

  // Mirror view/window/open card into the URL so it can be shared. Uses
  // replaceState (no history entries, no re-render, so no loop), and keeps
  // any other params plus the path and hash untouched. While the catalog
  // is still loading, a pending ?card= is left alone.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (view === 'movers') params.set('view', 'movers')
    else params.delete('view')
    if (view === 'movers' && moversWindow !== DEFAULT_MOVER_WINDOW) params.set('w', moversWindow)
    else params.delete('w')
    if (view === 'movers' && moversNation) params.set('nation', moversNation)
    else params.delete('nation')
    if (selectedCard) params.set('card', selectedCard.id)
    else if (status !== 'loading') params.delete('card')
    // "/" is legal in a query string; leaving it unescaped keeps shared
    // links readable (?card=dzbt14/10318 rather than dzbt14%2F10318).
    const query = params.toString().replace(/%2F/gi, '/')
    const { pathname, search, hash } = window.location
    const next = `${pathname}${query ? `?${query}` : ''}${hash}`
    if (next !== `${pathname}${search}${hash}`) {
      window.history.replaceState(window.history.state, '', next)
    }
  }, [view, moversWindow, moversNation, selectedCard, status])

  // A ?nation= the loaded catalog doesn't know (a typo'd link, or a catalog
  // that predates the filter) would otherwise empty every Movers list.
  useEffect(() => {
    if (status === 'ready' && moversNation && !nations.some((n) => n.code === moversNation)) setMoversNation('')
  }, [status, nations, moversNation])

  // Fetch JPY exchange rates once on mount, independent of the catalog load
  // (currency defaults to JPY so this never blocks anything — it just makes
  // switching currency later feel instant, since getRates() itself already
  // caches to localStorage and falls back gracefully on failure).
  useEffect(() => {
    let cancelled = false
    getRates().then((r) => {
      if (!cancelled) setRates(r)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // id -> card, for joining movers.json entries against the catalog.
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])

  // Distinct sets present in the loaded catalog, for the set search dropdown.
  const setOptions = useMemo(() => {
    const slugs = new Set()
    for (const card of cards) {
      if (card.setSlug) slugs.add(card.setSlug)
    }
    return Array.from(slugs).sort()
  }, [cards])

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

  // Switching to a set that doesn't have the currently-selected rarity
  // (or back to "All Sets", which can only narrow the list further) would
  // otherwise silently show zero results with no clue why -- reset instead.
  useEffect(() => {
    if (rarity && !rarityOptions.includes(rarity)) setRarity('')
  }, [rarityOptions, rarity])

  // Text search, the set dropdown, and the rarity dropdown all AND
  // together. All cheap linear scans over the in-memory array, and
  // re-running this only depends on the deferred (lagged) query plus the
  // two dropdown filters, not on pagination.
  const filteredCards = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    if (!q && !rarity) return setScopedCards
    return setScopedCards.filter(
      (card) => (!rarity || card.rarity === rarity) && (!q || searchText.get(card).includes(q))
    )
  }, [setScopedCards, searchText, deferredQuery, rarity])

  const sortedCards = useMemo(() => sortCards(filteredCards, sort), [filteredCards, sort])

  // Whenever the effective filter or sort changes, snap back to page 1 —
  // otherwise narrowing a search while sitting on page 40 could land on an
  // empty page (and a re-sort would drop you mid-list).
  useEffect(() => {
    setPage(1)
  }, [deferredQuery, setSlug, rarity, sort])

  // A single set tops out around 300-400 cards (vs. tens of thousands for
  // the whole catalog), so once one is picked there's no need to paginate --
  // show everything at once, grouped into per-rarity sections instead.
  const isSetSelected = setSlug !== ''

  const totalPages = Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const startIndex = (safePage - 1) * PAGE_SIZE
  const pageCards = useMemo(
    () => sortedCards.slice(startIndex, startIndex + PAGE_SIZE),
    [sortedCards, startIndex]
  )

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

  const isFiltered = deferredQuery.trim().length > 0 || setSlug !== '' || rarity !== ''
  const rangeStart = filteredCards.length === 0 ? 0 : startIndex + 1
  const rangeEnd = Math.min(startIndex + PAGE_SIZE, filteredCards.length)
  const countLabel = filteredCards.length.toLocaleString()

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-night-900">
      <Header meta={meta} theme={theme} onToggleTheme={toggleTheme} />

      <main className="flex-1">
        <ViewTabs view={view} onChange={setView} />

        {/* The search view stays mounted (just hidden) while Movers shows,
            so switching back doesn't re-run the search box's autofocus --
            which would pop the keyboard open on phones -- or reset the set
            filter's typed text. */}
        <div hidden={view !== 'search'}>
          <div className="pb-6 pt-4">
            <SearchBar value={query} onChange={setQuery} />

            <div className="mx-auto mt-3 flex max-w-3xl flex-wrap items-start justify-center gap-2 px-4">
              <SetFilter options={setOptions} value={setSlug} onChange={setSetSlug} />
              <RarityFilter options={rarityOptions} value={rarity} onChange={setRarity} />
              <SortSelect value={sort} onChange={setSort} />
              <CurrencySelector value={currency} onChange={setCurrency} />
            </div>

            <div className="mx-auto mt-3 max-w-xl px-4 text-center text-xs text-slate-500 dark:text-gold-500/70">
              {status === 'ready' &&
                (filteredCards.length === 0
                  ? isFiltered
                    ? 'No cards match your search.'
                    : 'No cards in catalog.'
                  : isSetSelected
                    ? `Showing all ${countLabel} ${isFiltered ? 'matching ' : ''}cards`
                    : `Showing ${rangeStart.toLocaleString()}-${rangeEnd.toLocaleString()} of ${countLabel} ${
                        isFiltered ? 'matching ' : ''
                      }cards`)}
            </div>

            {status === 'ready' && meta && (
              <div className="mx-auto mt-1 max-w-xl px-4 text-center text-[11px] text-slate-400 dark:text-gold-500/50">
                {meta.fromCache
                  ? 'Loaded from today’s local cache.'
                  : 'Freshly loaded — now cached for the rest of today.'}{' '}
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="font-medium text-brand-600 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 dark:text-brand-400 dark:disabled:text-night-500"
                >
                  {isRefreshing ? 'Refreshing…' : 'Refresh now'}
                </button>
                {refreshError && (
                  <p role="alert" className="mt-1 text-red-600 dark:text-red-400">
                    Refresh failed — still showing the catalog you had. ({refreshError})
                  </p>
                )}
              </div>
            )}
          </div>

          {status === 'loading' && (
            <div>
              <p className="pb-4 text-center text-sm text-slate-500 dark:text-gold-500/70">
                Loading full card catalog…
              </p>
              <div className="grid grid-cols-2 gap-3 px-4 pb-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {Array.from({ length: 16 }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-[100/140] w-full animate-pulse rounded-md bg-slate-200 dark:bg-night-700"
                  />
                ))}
              </div>
            </div>
          )}

          {status === 'ready' && isSetSelected && (
            <RaritySections
              sections={raritySections}
              currency={currency}
              rates={rates}
              onSelect={setSelectedCard}
            />
          )}

          {status === 'ready' && !isSetSelected && (
            <>
              <CardGrid
                cards={pageCards}
                currency={currency}
                rates={rates}
                onSelect={setSelectedCard}
              />
              <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
            </>
          )}
        </div>

        {view === 'movers' && status !== 'error' && (
          <MoversView
            cardsById={cardsById}
            catalogReady={status === 'ready'}
            dataVersion={dataVersion}
            currency={currency}
            rates={rates}
            onCurrencyChange={setCurrency}
            windowKey={moversWindow}
            onWindowChange={setMoversWindow}
            minPrice={minPrice}
            onMinPriceChange={setMinPrice}
            nations={nations}
            nation={moversNation}
            onNationChange={setMoversNation}
            onSelect={setSelectedCard}
          />
        )}

        {status === 'error' && (
          <div className="mx-auto max-w-md px-4 py-16 text-center">
            <p className="text-sm font-semibold text-red-600">
              Couldn&apos;t load cards.
            </p>
            <p className="mt-2 text-xs text-slate-500 dark:text-gold-500/70">{errorMessage}</p>
            <p className="mt-4 text-xs text-slate-400 dark:text-gold-500/50">Reload the page to try again.</p>
          </div>
        )}
      </main>

      <Footer />

      <CardModal
        card={selectedCard}
        currency={currency}
        rates={rates}
        onClose={closeModal}
        catalogGeneratedAt={meta?.generatedAt}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        refreshError={refreshError}
        dataVersion={dataVersion}
      />
    </div>
  )
}

export default App
