import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { fetchCatalog, refreshCatalog } from './api'
import { getRates } from './currency'
import { applyTheme, getInitialTheme } from './theme'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import SetFilter from './components/SetFilter'
import RarityFilter from './components/RarityFilter'
import CurrencySelector from './components/CurrencySelector'
import CardGrid from './components/CardGrid'
import RaritySections from './components/RaritySections'
import CardModal from './components/CardModal'
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

function App() {
  const [cards, setCards] = useState([])
  const [meta, setMeta] = useState(null) // { generatedAt, count }
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [errorMessage, setErrorMessage] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [setSlug, setSetSlug] = useState('') // '' = All Sets
  const [rarity, setRarity] = useState('') // '' = All Rarities
  const [page, setPage] = useState(1)
  const [currency, setCurrency] = useState('JPY')
  const [rates, setRates] = useState(null)
  const [selectedCard, setSelectedCard] = useState(null)
  const [theme, setTheme] = useState(getInitialTheme)

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
        setMeta({ generatedAt: data.generatedAt, count: data.count, fromCache: data.fromCache })
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
  // cache instead of waiting for it to expire on its own.
  const handleRefresh = useCallback(() => {
    setIsRefreshing(true)
    refreshCatalog()
      .then((data) => {
        setCards(data.cards)
        setMeta({ generatedAt: data.generatedAt, count: data.count, fromCache: data.fromCache })
      })
      .catch((err) => {
        setErrorMessage(err.message)
        setStatus('error')
      })
      .finally(() => setIsRefreshing(false))
  }, [])

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

  // Whenever the effective filter changes, snap back to page 1 — otherwise
  // narrowing a search while sitting on page 40 could land on an empty page.
  useEffect(() => {
    setPage(1)
  }, [deferredQuery, setSlug, rarity])

  // A single set tops out around 300-400 cards (vs. tens of thousands for
  // the whole catalog), so once one is picked there's no need to paginate --
  // show everything at once, grouped into per-rarity sections instead.
  const isSetSelected = setSlug !== ''

  const totalPages = Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const startIndex = (safePage - 1) * PAGE_SIZE
  const pageCards = useMemo(
    () => filteredCards.slice(startIndex, startIndex + PAGE_SIZE),
    [filteredCards, startIndex]
  )

  // Group filteredCards by rarity, in the same rarest-first order as the
  // dropdown, for the sectioned single-set view. A rarity with no cards
  // left after the search/rarity filters narrowed things down just doesn't
  // get a section, rather than rendering an empty one.
  const raritySections = useMemo(() => {
    if (!isSetSelected) return []
    const byRarity = new Map()
    for (const card of filteredCards) {
      const key = card.rarity || ''
      if (!byRarity.has(key)) byRarity.set(key, [])
      byRarity.get(key).push(card)
    }
    const order = rarityOptions.length > 0 ? rarityOptions : Array.from(byRarity.keys())
    return order.filter((r) => byRarity.has(r)).map((r) => ({ rarity: r, cards: byRarity.get(r) }))
  }, [isSetSelected, filteredCards, rarityOptions])

  const isFiltered = deferredQuery.trim().length > 0 || setSlug !== '' || rarity !== ''
  const rangeStart = filteredCards.length === 0 ? 0 : startIndex + 1
  const rangeEnd = Math.min(startIndex + PAGE_SIZE, filteredCards.length)
  const countLabel = filteredCards.length.toLocaleString()

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-night-900">
      <Header meta={meta} theme={theme} onToggleTheme={toggleTheme} />

      <main className="flex-1">
        <div className="py-6">
          <SearchBar value={query} onChange={setQuery} />

          <div className="mx-auto mt-3 flex max-w-2xl flex-wrap items-start justify-center gap-2 px-4">
            <SetFilter options={setOptions} value={setSlug} onChange={setSetSlug} />
            <RarityFilter options={rarityOptions} value={rarity} onChange={setRarity} />
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

        {status === 'error' && (
          <div className="mx-auto max-w-md px-4 py-16 text-center">
            <p className="text-sm font-semibold text-red-600">
              Couldn&apos;t load cards.
            </p>
            <p className="mt-2 text-xs text-slate-500 dark:text-gold-500/70">{errorMessage}</p>
            <p className="mt-4 text-xs text-slate-400 dark:text-gold-500/50">Reload the page to try again.</p>
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
      </main>

      <Footer />

      <CardModal
        card={selectedCard}
        currency={currency}
        rates={rates}
        onClose={closeModal}
      />
    </div>
  )
}

export default App
