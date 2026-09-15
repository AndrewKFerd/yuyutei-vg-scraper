import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { fetchCatalog, refreshCatalog } from './api'
import { getRates } from './currency'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import SetFilter from './components/SetFilter'
import RarityFilter from './components/RarityFilter'
import CurrencySelector from './components/CurrencySelector'
import CardGrid from './components/CardGrid'
import Pagination from './components/Pagination'
import Footer from './components/Footer'

// Preferred display order for the rarity dropdown (rarest/most notable
// first); anything not listed here (yuyu-tei adds new codes over time) is
// appended afterward, alphabetically.
const RARITY_ORDER = ['SEC', 'SP', 'FFR', 'SR', 'RRR', 'RR', 'R', 'C']

// The catalog now spans the entire Vanguard card range (tens of thousands
// of rows), so we never render every matching card's <img> at once —
// results are sliced into fixed-size pages client-side. 150 keeps a page
// comfortably under a second to paint on modest hardware while still
// feeling like "a lot of cards" rather than a trickle. No virtualization
// library needed: plain slicing is simpler, has zero new dependencies, and
// is plenty fast since the expensive part (filtering the in-memory array)
// is already memoized separately from pagination.
const PAGE_SIZE = 150

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

  // Distinct rarities present in the loaded catalog, known ones first (in a
  // sensible rarest-first order), anything unrecognized appended after.
  const rarityOptions = useMemo(() => {
    const present = new Set()
    for (const card of cards) {
      if (card.rarity) present.add(card.rarity)
    }
    const known = RARITY_ORDER.filter((r) => present.has(r))
    const unknown = Array.from(present)
      .filter((r) => !RARITY_ORDER.includes(r))
      .sort()
    return [...known, ...unknown]
  }, [cards])

  // Text search, the set dropdown, and the rarity dropdown all AND
  // together. All cheap linear scans over the in-memory array, and
  // re-running this only depends on the deferred (lagged) query plus the
  // two dropdown filters, not on pagination.
  const filteredCards = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    return cards.filter((card) => {
      if (setSlug && card.setSlug !== setSlug) return false
      if (rarity && card.rarity !== rarity) return false
      if (!q) return true
      return (
        card.nameEn?.toLowerCase().includes(q) ||
        card.nameJp?.toLowerCase().includes(q) ||
        card.setCode?.toLowerCase().includes(q) ||
        card.rarity?.toLowerCase().includes(q)
      )
    })
  }, [cards, deferredQuery, setSlug, rarity])

  // Whenever the effective filter changes, snap back to page 1 — otherwise
  // narrowing a search while sitting on page 40 could land on an empty page.
  useEffect(() => {
    setPage(1)
  }, [deferredQuery, setSlug, rarity])

  const totalPages = Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const startIndex = (safePage - 1) * PAGE_SIZE
  const pageCards = useMemo(
    () => filteredCards.slice(startIndex, startIndex + PAGE_SIZE),
    [filteredCards, startIndex]
  )

  const isFiltered = deferredQuery.trim().length > 0 || setSlug !== '' || rarity !== ''
  const rangeStart = filteredCards.length === 0 ? 0 : startIndex + 1
  const rangeEnd = Math.min(startIndex + PAGE_SIZE, filteredCards.length)

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Header meta={meta} />

      <main className="flex-1">
        <div className="py-6">
          <SearchBar value={query} onChange={setQuery} />

          <div className="mx-auto mt-3 flex max-w-2xl flex-wrap items-start justify-center gap-2 px-4">
            <SetFilter options={setOptions} value={setSlug} onChange={setSetSlug} />
            <RarityFilter options={rarityOptions} value={rarity} onChange={setRarity} />
            <CurrencySelector value={currency} onChange={setCurrency} />
          </div>

          <div className="mx-auto mt-3 max-w-xl px-4 text-center text-xs text-slate-500">
            {status === 'ready' &&
              (filteredCards.length === 0
                ? isFiltered
                  ? 'No cards match your search.'
                  : 'No cards in catalog.'
                : `Showing ${rangeStart.toLocaleString()}-${rangeEnd.toLocaleString()} of ${filteredCards.length.toLocaleString()} ${
                    isFiltered ? 'matching ' : ''
                  }cards`)}
          </div>

          {status === 'ready' && meta && (
            <div className="mx-auto mt-1 max-w-xl px-4 text-center text-[11px] text-slate-400">
              {meta.fromCache
                ? 'Loaded from today’s local cache.'
                : 'Freshly loaded — now cached for the rest of today.'}{' '}
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="font-medium text-blue-600 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-slate-400"
              >
                {isRefreshing ? 'Refreshing…' : 'Refresh now'}
              </button>
            </div>
          )}
        </div>

        {status === 'loading' && (
          <div>
            <p className="pb-4 text-center text-sm text-slate-500">
              Loading full card catalog…
            </p>
            <div className="grid grid-cols-2 gap-3 px-4 pb-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
              {Array.from({ length: 16 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-[100/140] w-full animate-pulse rounded-md bg-slate-200"
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
            <p className="mt-2 text-xs text-slate-500">{errorMessage}</p>
            <p className="mt-4 text-xs text-slate-400">Reload the page to try again.</p>
          </div>
        )}

        {status === 'ready' && (
          <>
            <CardGrid cards={pageCards} currency={currency} rates={rates} />
            <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
          </>
        )}
      </main>

      <Footer />
    </div>
  )
}

export default App
