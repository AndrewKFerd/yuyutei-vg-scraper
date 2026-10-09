import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { fetchCatalog, refreshCatalog } from './api'
import { getRates } from './currency'
import { DEFAULT_MOVER_WINDOW, MOVER_WINDOWS } from './history'
import { applyTheme, getInitialTheme } from './theme'
import { useCalculator } from './useCalculator'
import { buildSetOptions, setLabel } from './sets'
import { SORT_OPTIONS, sortCards } from './sorting'
import { CONTAINER } from './ui'
import Header from './components/Header'
import { FilterSummary, SearchToolbar } from './components/SearchToolbar'
import CardGrid, { GridSkeleton } from './components/CardGrid'
import RaritySections from './components/RaritySections'
import CardModal from './components/CardModal'
import CalculatorBar, { CalculatorPanel } from './components/CalculatorBar'
import MoversView, { DEFAULT_MIN_PRICE } from './components/MoversView'
import Pagination from './components/Pagination'
import Footer from './components/Footer'
import Icon from './components/icons'
import { Button, IconButton } from './components/controls'

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

const SORT_KEYS = SORT_OPTIONS.map(([key]) => key)

// Shareable URL state, no router dependency. Search view: ?q= (text),
// &set=<slug>, &rarity=, &sort= and &page= (defaults left out). Movers:
// ?view=movers, &w=24h|30d (the 7d default is left out) and &nation=<code>.
// Either view: &card=<id> opens that card's modal. Set, rarity and nation
// are checked against the catalog once it has loaded.
function readUrlState() {
  const params = new URLSearchParams(window.location.search)
  const w = params.get('w')
  const sort = params.get('sort')
  const page = Number(params.get('page'))
  return {
    view: params.get('view') === 'movers' ? 'movers' : 'search',
    moversWindow: MOVER_WINDOWS.includes(w) ? w : DEFAULT_MOVER_WINDOW,
    moversNation: params.get('nation') || '',
    cardId: params.get('card') || null,
    query: params.get('q') || '',
    setSlug: params.get('set') || '',
    rarity: params.get('rarity') || '',
    sort: SORT_KEYS.includes(sort) ? sort : 'default',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  }
}

// What resets the page number: a different search, filter or sort.
const filterKeyOf = (query, setSlug, rarity, sort) => JSON.stringify([query.trim().toLowerCase(), setSlug, rarity, sort])

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// One-time tip pointing at the tiles' "+" buttons, until it's dismissed or
// the visitor has used the price list at all.
const HINT_KEY = 'yuyutei:priceListHintDone'
function readHintDone() {
  try {
    return localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return false
  }
}
function saveHintDone() {
  try {
    localStorage.setItem(HINT_KEY, '1')
  } catch {
    // fine — the tip just shows again next visit
  }
}

function PriceListHint({ onDismiss }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-accent-soft py-1.5 pl-3 pr-1.5 text-sm text-fg">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-fg shadow-sm ring-1 ring-line-strong">
        <Icon name="plus" className="h-3.5 w-3.5" />
      </span>
      <p className="min-w-0 flex-1">
        Tap <span className="font-semibold">+</span> on a card to start a price list with a running total.
      </p>
      <IconButton icon="close" label="Dismiss tip" size="sm" onClick={onDismiss} />
    </div>
  )
}

function App() {
  const [initialUrl] = useState(readUrlState)
  const [cards, setCards] = useState([])
  const [meta, setMeta] = useState(null) // { generatedAt, count }
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [errorMessage, setErrorMessage] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  // Why the last refresh failed, shown in the header; the already-loaded
  // catalog stays up either way.
  const [refreshError, setRefreshError] = useState('')
  const [query, setQuery] = useState(initialUrl.query)
  const [setSlug, setSetSlug] = useState(initialUrl.setSlug) // '' = all sets
  const [rarity, setRarity] = useState(initialUrl.rarity) // '' = all rarities
  const [sort, setSort] = useState(initialUrl.sort)
  const [currency, setCurrency] = useState('JPY')
  const [rates, setRates] = useState(null)
  // The open card, plus the list its previous/next buttons step through
  // (null when it was opened from somewhere without one, e.g. a link).
  const [selection, setSelection] = useState({ card: null, list: null })
  const selectedCard = selection.card
  const [theme, setTheme] = useState(getInitialTheme)
  const [view, setView] = useState(initialUrl.view) // 'search' | 'movers'
  const [moversWindow, setMoversWindow] = useState(initialUrl.moversWindow)
  const [minPrice, setMinPrice] = useState(DEFAULT_MIN_PRICE)
  const [moversNation, setMoversNation] = useState(initialUrl.moversNation) // '' = all nations
  // [{code, label, group}] from the catalog; empty for one that predates it.
  const [nations, setNations] = useState([])
  // [{slug, code, name}] from the catalog; empty for one that predates it.
  const [catalogSets, setCatalogSets] = useState([])
  // A ?card= deep link waits here until the catalog has loaded.
  const pendingCardIdRef = useRef(initialUrl.cardId)
  // Bumped after a manual refresh (which also drops the history/movers
  // caches) so the Movers view and card modal reload them.
  const [dataVersion, setDataVersion] = useState(0)
  const resultsRef = useRef(null)
  const [hintDone, setHintDone] = useState(readHintDone)

  // index.html already applied the initial theme before first paint; this
  // keeps <html> in sync whenever the user toggles it afterwards.
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  // Stable identities: CardModal's keydown/scroll-lock effect depends on
  // closeModal, and the tiles' memo on selectCard -- an inline arrow would
  // re-run / re-render them on every App render (every keystroke).
  const closeModal = useCallback(() => setSelection({ card: null, list: null }), [])
  const selectCard = useCallback((card, list = null) => setSelection({ card, list }), [])

  // Price calculator: the list lives in the hook (and localStorage); the
  // panel's open state and its "View list" button (where focus returns on
  // close) live here.
  const [calcOpen, setCalcOpen] = useState(false)
  const closeCalc = useCallback(() => setCalcOpen(false), [])
  const openCalc = useCallback(() => setCalcOpen(true), [])
  const calcButtonRef = useRef(null)

  // Keeps the input snappy: the text state updates immediately on every
  // keystroke, while the (potentially expensive) filtered grid re-render
  // can lag a frame behind under React's control.
  const deferredQuery = useDeferredValue(query)

  const applyCatalog = useCallback((data) => {
    setCards(data.cards)
    setNations(Array.isArray(data.nations) ? data.nations : [])
    setCatalogSets(Array.isArray(data.sets) ? data.sets : [])
    setMeta({ generatedAt: data.generatedAt, count: data.count })
  }, [])

  useEffect(() => {
    let cancelled = false

    setStatus('loading')
    fetchCatalog()
      .then((data) => {
        if (cancelled) return
        applyCatalog(data)
        // Open a deep-linked card in the same render the grid appears in
        // (unknown ids are just ignored).
        const deepLinkId = pendingCardIdRef.current
        pendingCardIdRef.current = null
        if (deepLinkId) {
          const linked = data.cards.find((card) => card.id === deepLinkId)
          if (linked) setSelection({ card: linked, list: null })
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
  }, [loadAttempt, applyCatalog])

  // Manual "get the latest data now" escape hatch — bypasses the catalog
  // cache instead of waiting for it to expire on its own. A failure only
  // shows a note: the catalog already on screen (and in the cache) is
  // still good, so it stays.
  const handleRefresh = useCallback(() => {
    setIsRefreshing(true)
    setRefreshError('')
    refreshCatalog()
      .then((data) => {
        applyCatalog(data)
        // The card modal can trigger this ("newer data than your cached
        // catalog"): swap the open card -- and the cards its previous/next
        // step through -- for their fresh copies.
        const fresh = new Map(data.cards.map((card) => [card.id, card]))
        setSelection((prev) =>
          prev.card
            ? {
                card: fresh.get(prev.card.id) || prev.card,
                list: prev.list && prev.list.map((card) => fresh.get(card.id) || card),
              }
            : prev
        )
        setDataVersion((v) => v + 1)
      })
      .catch((err) => setRefreshError(err.message))
      .finally(() => setIsRefreshing(false))
  }, [applyCatalog])

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
    if (status !== 'ready') return
    if (setSlug && !setOptions.some((set) => set.slug === setSlug)) setSetSlug('')
  }, [status, setOptions, setSlug])
  useEffect(() => {
    if (status !== 'ready') return
    if (rarity && !rarityOptions.includes(rarity)) setRarity('')
  }, [status, rarityOptions, rarity])
  // Same for a ?nation= the catalog doesn't know, which would otherwise
  // empty every Movers list.
  useEffect(() => {
    if (status === 'ready' && moversNation && !nations.some((n) => n.code === moversNation)) setMoversNation('')
  }, [status, nations, moversNation])

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

  const calc = useCalculator({
    cardsById,
    catalogReady: status === 'ready',
    catalogGeneratedAt: meta?.generatedAt,
  })
  // Room for the sticky calculator bar so Pagination/Footer stay reachable.
  const calcBarVisible = calc.items.length > 0 || Boolean(calc.undoInfo) || calcOpen

  // The tip has done its job once the price list has been used at all.
  const hasCalcItems = calc.items.length > 0
  useEffect(() => {
    if (hasCalcItems && !hintDone) {
      saveHintDone()
      setHintDone(true)
    }
  }, [hasCalcItems, hintDone])
  const dismissHint = useCallback(() => {
    saveHintDone()
    setHintDone(true)
  }, [])

  const sortedCards = useMemo(() => sortCards(filteredCards, sort), [filteredCards, sort])

  // The page number belongs to one search/filter/sort combination: change
  // any of them and you're back on page 1 (narrowing a search while on page
  // 40 would otherwise land on an empty page). Stored with the key it was
  // set under rather than reset by an effect, so a ?page= from a shared
  // link survives the first render.
  const filterKey = filterKeyOf(deferredQuery, setSlug, rarity, sort)
  const [pageState, setPageState] = useState(() => ({
    key: filterKeyOf(initialUrl.query, initialUrl.setSlug, initialUrl.rarity, initialUrl.sort),
    page: initialUrl.page,
  }))
  const page = pageState.key === filterKey ? pageState.page : 1

  // A single set tops out around 300-400 cards (vs. tens of thousands for
  // the whole catalog), so once one is picked there's no need to paginate --
  // show everything at once, grouped into per-rarity sections instead.
  const isSetSelected = setSlug !== ''

  const totalPages = Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE))
  const safePage = status === 'ready' ? Math.min(page, totalPages) : page
  const startIndex = (safePage - 1) * PAGE_SIZE
  const pageCards = useMemo(
    () => sortedCards.slice(startIndex, startIndex + PAGE_SIZE),
    [sortedCards, startIndex]
  )

  const goToPage = useCallback(
    (next) => {
      setPageState({ key: filterKey, page: next })
      resultsRef.current?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    },
    [filterKey]
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
  // The sections' cards in display order, for the modal's previous/next.
  const sectionCards = useMemo(() => raritySections.flatMap((s) => s.cards), [raritySections])

  // Mirror the view, its filters and the open card into the URL so it can
  // be shared or reloaded. Uses replaceState (no history entries, no
  // re-render, so no loop), and keeps any other params plus the path and
  // hash untouched. While the catalog is still loading, a pending ?card= is
  // left alone.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const put = (key, value) => (value ? params.set(key, value) : params.delete(key))
    const search = view === 'search'
    put('view', search ? '' : 'movers')
    put('w', !search && moversWindow !== DEFAULT_MOVER_WINDOW ? moversWindow : '')
    put('nation', !search ? moversNation : '')
    put('q', search ? deferredQuery.trim() : '')
    put('set', search ? setSlug : '')
    put('rarity', search ? rarity : '')
    put('sort', search && sort !== 'default' ? sort : '')
    put('page', search && !isSetSelected && safePage > 1 ? String(safePage) : '')
    if (selectedCard) params.set('card', selectedCard.id)
    else if (status !== 'loading') params.delete('card')
    // "/" is legal in a query string; leaving it unescaped keeps shared
    // links readable (?card=dzbt14/10318 rather than dzbt14%2F10318).
    const query = params.toString().replace(/%2F/gi, '/')
    const { pathname, search: current, hash } = window.location
    const next = `${pathname}${query ? `?${query}` : ''}${hash}`
    if (next !== `${pathname}${current}${hash}`) {
      window.history.replaceState(window.history.state, '', next)
    }
  }, [view, moversWindow, moversNation, deferredQuery, setSlug, rarity, sort, safePage, isSetSelected, selectedCard, status])

  const clearAll = useCallback(() => {
    setQuery('')
    setSetSlug('')
    setRarity('')
    setSort('default')
  }, [])

  // Previous/next in the card modal: neighbours in the list it was opened from.
  const selectionIndex =
    selection.card && selection.list ? selection.list.findIndex((card) => card.id === selection.card.id) : -1
  const stepSelection = useCallback(
    (delta) =>
      setSelection((prev) => {
        if (!prev.card || !prev.list) return prev
        const i = prev.list.findIndex((card) => card.id === prev.card.id)
        const next = prev.list[i + delta]
        return next ? { card: next, list: prev.list } : prev
      }),
    []
  )
  const showPrev = useCallback(() => stepSelection(-1), [stepSelection])
  const showNext = useCallback(() => stepSelection(1), [stepSelection])
  const modalPosition =
    selectionIndex >= 0 ? { index: selectionIndex, total: selection.list.length } : null

  const isFiltered = deferredQuery.trim().length > 0 || setSlug !== '' || rarity !== ''
  const countLabel = filteredCards.length.toLocaleString()
  const cardsWord = filteredCards.length === 1 ? 'card' : 'cards'
  const summary =
    status !== 'ready'
      ? 'Loading cards…'
      : filteredCards.length === 0
        ? 'No matching cards'
        : isSetSelected
          ? `${countLabel} ${isFiltered && (deferredQuery.trim() || rarity) ? 'matching ' : ''}${cardsWord}`
          : `Showing ${(startIndex + 1).toLocaleString()}–${Math.min(startIndex + PAGE_SIZE, filteredCards.length).toLocaleString()} of ${countLabel} ${isFiltered ? 'matching ' : ''}${cardsWord}`

  return (
    <div className={`flex min-h-screen flex-col bg-bg ${calcBarVisible ? 'pb-28' : ''}`}>
      <Header
        meta={meta}
        theme={theme}
        onToggleTheme={toggleTheme}
        view={view}
        onViewChange={setView}
        currency={currency}
        onCurrencyChange={setCurrency}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        refreshError={refreshError}
      />

      <main className="flex-1">
        {/* The search view stays mounted (just hidden) while Movers shows,
            so switching back doesn't re-run the search box's autofocus or
            reset the set filter's typed text. */}
        <div hidden={view !== 'search' || status === 'error'} className={`${CONTAINER} pt-5`}>
          <SearchToolbar
            query={query}
            onQueryChange={setQuery}
            setOptions={setOptions}
            setSlug={setSlug}
            onSetChange={setSetSlug}
            rarityOptions={rarityOptions}
            rarity={rarity}
            onRarityChange={setRarity}
            sort={sort}
            onSortChange={setSort}
          />

          <div ref={resultsRef} className="scroll-mt-4 pb-4 pt-4">
            <FilterSummary
              summary={summary}
              set={selectedSet}
              rarity={rarity}
              sort={sort}
              query={deferredQuery.trim()}
              onClearSet={() => setSetSlug('')}
              onClearRarity={() => setRarity('')}
              onClearSort={() => setSort('default')}
              onClearAll={clearAll}
            />
          </div>

          {status === 'ready' && !hintDone && filteredCards.length > 0 && (
            <div className="pb-4">
              <PriceListHint onDismiss={dismissHint} />
            </div>
          )}

          {status === 'loading' && <GridSkeleton className="pb-10" />}

          {status === 'ready' && filteredCards.length === 0 && (
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
              <Icon name="search" className="h-8 w-8 text-fg-subtle" />
              <p className="text-base font-semibold text-fg">
                {isFiltered ? 'No cards match' : 'The catalog is empty'}
              </p>
              {isFiltered && (
                <>
                  <p className="text-sm text-fg-muted">
                    {[
                      deferredQuery.trim() && `“${deferredQuery.trim()}”`,
                      selectedSet && `in ${setLabel(selectedSet)}`,
                      rarity && `at ${rarity} rarity`,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    {' '}— try a shorter search or fewer filters.
                  </p>
                  <Button variant="primary" onClick={clearAll}>
                    Clear search and filters
                  </Button>
                </>
              )}
            </div>
          )}

          {status === 'ready' && isSetSelected && filteredCards.length > 0 && (
            <section aria-labelledby="set-heading" className="pb-10">
              <h2 id="set-heading" className="mb-4 flex flex-wrap items-baseline gap-x-2 border-b border-line pb-2">
                {selectedSet?.code && <span className="font-mono text-lg font-bold text-fg">{selectedSet.code}</span>}
                <span lang={selectedSet?.code ? 'ja' : undefined} className="text-base font-semibold text-fg-muted">
                  {selectedSet?.code ? selectedSet.name : setLabel(selectedSet)}
                </span>
              </h2>
              <RaritySections
                sections={raritySections}
                allCards={sectionCards}
                currency={currency}
                rates={rates}
                onSelect={selectCard}
                qtyById={calc.qtyById}
                onToggle={calc.toggle}
              />
            </section>
          )}

          {status === 'ready' && !isSetSelected && filteredCards.length > 0 && (
            <>
              <CardGrid
                cards={pageCards}
                currency={currency}
                rates={rates}
                onSelect={selectCard}
                qtyById={calc.qtyById}
                onToggle={calc.toggle}
                className="pb-6"
              />
              <Pagination page={safePage} totalPages={totalPages} onChange={goToPage} />
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
            windowKey={moversWindow}
            onWindowChange={setMoversWindow}
            minPrice={minPrice}
            onMinPriceChange={setMinPrice}
            nations={nations}
            nation={moversNation}
            onNationChange={setMoversNation}
            onSelect={selectCard}
            qtyById={calc.qtyById}
            onToggle={calc.toggle}
          />
        )}

        {status === 'error' && (
          <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
            <p className="text-base font-semibold text-fg">Couldn’t load the card catalog</p>
            <p className="text-sm text-fg-muted">{errorMessage}</p>
            <Button variant="primary" onClick={() => setLoadAttempt((n) => n + 1)}>
              <Icon name="refresh" className="h-4 w-4" />
              Try again
            </Button>
          </div>
        )}
      </main>

      <Footer />

      <CardModal
        card={selectedCard}
        currency={currency}
        rates={rates}
        onClose={closeModal}
        onPrev={selectionIndex > 0 ? showPrev : null}
        onNext={selectionIndex >= 0 && selectionIndex < selection.list.length - 1 ? showNext : null}
        position={modalPosition}
        catalogGeneratedAt={meta?.generatedAt}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        refreshError={refreshError}
        dataVersion={dataVersion}
        calcQty={selectedCard ? calc.qtyById.get(selectedCard.id) || 0 : 0}
        onCalcChange={calc.setQtyFor}
      />

      <CalculatorBar
        calc={calc}
        currency={currency}
        rates={rates}
        visible={calcBarVisible}
        panelOpen={calcOpen}
        onOpenPanel={openCalc}
        buttonRef={calcButtonRef}
      />
      {calcOpen && (
        <CalculatorPanel
          calc={calc}
          currency={currency}
          rates={rates}
          onClose={closeCalc}
          onOpenCard={selectCard}
          suspended={Boolean(selectedCard)}
          returnFocusRef={calcButtonRef}
        />
      )}
    </div>
  )
}

export default App
