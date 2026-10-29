import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { getRates } from './lib/currency'
import { prefersReducedMotion } from './ui/motion'
import { useTheme } from './app/useTheme'
import { bannerImageUrls } from './lib/banner'
import { useCalculator } from './features/calculator/useCalculator'
import { useCatalog } from './app/useCatalog'
import { useLiveUpdates } from './app/useLiveUpdates'
import { useSavedLists } from './features/saved-lists/useSavedLists'
import { useSearch } from './features/search/useSearch'
import { useWatchlist } from './features/watchlist/useWatchlist'
import { readUrlState, useUrlSync } from './app/useUrlState'
import Header from './app/Header'
import EmptyState from './ui/EmptyState'
import SearchView from './features/search/SearchView'
import CardModal from './features/card/CardModal'
import CalculatorBar, { CalculatorPanel } from './features/calculator/CalculatorBar'
import MoversView, { DEFAULT_MIN_PRICE } from './features/movers/MoversView'
import SavedListsView from './features/saved-lists/SavedListsView'
import WatchlistView from './features/watchlist/WatchlistView'
import PdfToast from './features/saved-lists/PdfToast'
import Footer from './app/Footer'
import Icon from './ui/icons'
import { Button } from './ui/controls'

// The page: which view shows, and the state the views, the card modal and
// the price list share. The catalog (useCatalog), the search (useSearch)
// and the URL (useUrlState) each live in their own hook.

function App() {
  const [initialUrl] = useState(readUrlState)
  const [currency, setCurrency] = useState('JPY')
  const [rates, setRates] = useState(null)
  // The open card, plus the list its previous/next buttons step through
  // (null when it was opened from somewhere without one, e.g. a link).
  const [selection, setSelection] = useState({ card: null, list: null })
  const selectedCard = selection.card
  const theme = useTheme()
  const [view, setView] = useState(initialUrl.view) // 'search' | 'movers' | 'lists' | 'watchlist'
  // The header's view switcher: a short cross-fade where the browser has
  // view transitions (styles in index.css), an instant switch otherwise.
  const changeView = useCallback((next) => {
    if (!document.startViewTransition || prefersReducedMotion()) return setView(next)
    document.startViewTransition(() => flushSync(() => setView(next)))
  }, [])
  const [moversWindow, setMoversWindow] = useState(initialUrl.moversWindow)
  const [minPrice, setMinPrice] = useState(DEFAULT_MIN_PRICE)
  const [moversNation, setMoversNation] = useState(initialUrl.moversNation) // '' = all nations
  // A ?card= deep link waits here until the catalog has loaded.
  const pendingCardIdRef = useRef(initialUrl.cardId)

  // Stable identities: CardModal's keydown/scroll-lock effect depends on
  // closeModal, and the tiles' memo on selectCard -- an inline arrow would
  // re-run / re-render them on every App render (every keystroke).
  const closeModal = useCallback(() => setSelection({ card: null, list: null }), [])
  const selectCard = useCallback((card, list = null) => setSelection({ card, list }), [])

  // Open a deep-linked card in the same render the grid appears in
  // (unknown ids are just ignored).
  const openDeepLink = useCallback((data) => {
    const deepLinkId = pendingCardIdRef.current
    pendingCardIdRef.current = null
    if (!deepLinkId) return
    const linked = data.cards.find((card) => card.id === deepLinkId)
    if (linked) setSelection({ card: linked, list: null })
  }, [])
  // The card modal can trigger a refresh ("newer data than your cached
  // catalog"): swap the open card -- and the cards its previous/next step
  // through -- for their fresh copies.
  const swapInFreshCards = useCallback((data) => {
    const fresh = new Map(data.cards.map((card) => [card.id, card]))
    setSelection((prev) =>
      prev.card
        ? {
            card: fresh.get(prev.card.id) || prev.card,
            list: prev.list && prev.list.map((card) => fresh.get(card.id) || card),
          }
        : prev
    )
  }, [])
  const catalog = useCatalog({ onLoaded: openDeepLink, onRefreshed: swapInFreshCards })
  const { cards, cardsById, meta, status } = catalog
  // Picks up newer prices within about a minute (or at once, with push): deltas when possible, a reload otherwise.
  const live = useLiveUpdates({
    ready: status === 'ready',
    loaded: meta,
    cards,
    applyPatch: catalog.applyPatch,
    reloadTo: catalog.reloadTo,
  })

  // The banner's card wall, from the loaded catalog (empty until then).
  const bannerUrls = useMemo(() => bannerImageUrls(cards), [cards])

  const search = useSearch({ initial: initialUrl, cards, catalogSets: catalog.sets, catalogReady: status === 'ready' })

  // Price calculator: the list lives in the hook (and localStorage); the
  // panel's open state and its "View list" button (where focus returns on
  // close) live here.
  const [calcOpen, setCalcOpen] = useState(false)
  const closeCalc = useCallback(() => setCalcOpen(false), [])
  const openCalc = useCallback(() => setCalcOpen(true), [])
  const calcButtonRef = useRef(null)

  // A saved list's PDF export (see PdfToast) and the note it leaves on that
  // list's sheet ({ listId, text }), here so they outlive a view switch.
  const [pdfJob, setPdfJob] = useState(null)
  const [pdfNote, setPdfNote] = useState(null)
  const clearPdfJob = useCallback((id) => setPdfJob((job) => (job?.id === id ? null : job)), [])
  const pdf = useMemo(() => ({ job: pdfJob, setJob: setPdfJob, note: pdfNote, setNote: setPdfNote }), [pdfJob, pdfNote])

  // Saved lists: stored by the hook; which one the view has open lives here
  // so the price list panel can open straight onto a list it just saved.
  const savedLists = useSavedLists()
  const [activeListId, setActiveListId] = useState(null)
  const openSavedLists = useCallback((listId) => {
    if (listId) setActiveListId(listId)
    setCalcOpen(false)
    setView('lists')
    // After the panel has closed (and handed focus back to "View list"),
    // land on the view's heading, scrolling it into view.
    requestAnimationFrame(() => document.getElementById('saved-lists-title')?.focus())
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

  // A ?nation= the catalog doesn't know would otherwise empty every Movers
  // list, so it's dropped once the catalog is in.
  useEffect(() => {
    if (status === 'ready' && moversNation && !catalog.nations.some((n) => n.code === moversNation)) setMoversNation('')
  }, [status, catalog.nations, moversNation])

  const calc = useCalculator({
    cardsById,
    catalogReady: status === 'ready',
    catalogGeneratedAt: meta?.generatedAt,
  })
  const watchlist = useWatchlist({
    cardsById,
    catalogReady: status === 'ready',
    catalogGeneratedAt: meta?.generatedAt,
    dataVersion: catalog.dataVersion,
  })
  // "(3) Yuyu-tei Card Search" while watched cards have news, so a pinned
  // or background tab shows it.
  const [baseTitle] = useState(() => document.title)
  useEffect(() => {
    document.title = watchlist.newsCount > 0 ? `(${watchlist.newsCount}) ${baseTitle}` : baseTitle
  }, [watchlist.newsCount, baseTitle])

  // Whether the sticky price-list bar is up (it reserves room under the page).
  const calcBarVisible = calc.items.length > 0 || Boolean(calc.undoInfo) || calcOpen

  useUrlSync({
    view,
    moversWindow,
    moversNation,
    query: search.deferredQuery,
    setSlug: search.setSlug,
    rarity: search.rarity,
    sort: search.sort,
    page: search.page,
    paged: !search.isSetSelected,
    cardId: selectedCard?.id || null,
    catalogLoading: status === 'loading',
    // Back/Forward: show that entry's view and card (a card id the catalog
    // doesn't hold leaves the modal as it is).
    onNavigate: (state) => {
      setView(state.view)
      setSelection((prev) => {
        if (!state.cardId) return prev.card ? { card: null, list: null } : prev
        if (prev.card?.id === state.cardId) return prev
        const card = cardsById.get(state.cardId)
        return card ? { card, list: null } : prev
      })
    },
  })

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

  return (
    <div
      className="flex min-h-screen flex-col bg-bg"
      // Room under the content for the sticky price-list bar, measured by
      // CalculatorBar (--calc-bar-h), so Pagination/Footer stay reachable.
      style={calcBarVisible ? { paddingBottom: 'calc(var(--calc-bar-h, 7rem) + 0.5rem)' } : undefined}
    >
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-accent-solid px-4 py-2 text-sm font-semibold text-on-accent focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <Header
        meta={meta}
        live={live}
        bannerUrls={bannerUrls}
        busy={status === 'loading' || catalog.isRefreshing}
        theme={theme}
        view={view}
        onViewChange={changeView}
        watchNews={watchlist.newsCount}
        currency={currency}
        onCurrencyChange={setCurrency}
        onRefresh={catalog.refresh}
        isRefreshing={catalog.isRefreshing}
        refreshError={catalog.refreshError}
      />

      <main id="main" tabIndex={-1} className="flex-1 scroll-mt-32 outline-none">
        <SearchView
          search={search}
          status={status}
          hidden={view !== 'search' || status === 'error'}
          currency={currency}
          rates={rates}
          calc={calc}
          onSelect={selectCard}
        />

        {view === 'movers' && status !== 'error' && (
          <MoversView
            cardsById={cardsById}
            catalogReady={status === 'ready'}
            dataVersion={catalog.dataVersion}
            currency={currency}
            rates={rates}
            windowKey={moversWindow}
            onWindowChange={setMoversWindow}
            minPrice={minPrice}
            onMinPriceChange={setMinPrice}
            nations={catalog.nations}
            nation={moversNation}
            onNationChange={setMoversNation}
            onSelect={selectCard}
            qtyById={calc.qtyById}
            onToggle={calc.toggle}
          />
        )}

        {/* Saved lists live in this browser, not the catalog, so they show
            even when it fails to load (the view says so itself). */}
        {view === 'lists' && (
          <SavedListsView
            saved={savedLists}
            calc={calc}
            cards={cards}
            cardsById={cardsById}
            catalogStatus={status}
            onRetryCatalog={catalog.retry}
            catalogGeneratedAt={meta?.generatedAt}
            pdf={pdf}
            currency={currency}
            rates={rates}
            activeId={activeListId}
            onActiveChange={setActiveListId}
            onSelectCard={selectCard}
            watchlist={watchlist}
          />
        )}

        {/* Like saved lists, the watchlist lives in this browser; the view
            says itself when the catalog it compares against fails. */}
        {view === 'watchlist' && (
          <WatchlistView
            watchlist={watchlist}
            calc={calc}
            catalogStatus={status}
            onRetryCatalog={catalog.retry}
            currency={currency}
            rates={rates}
            onSelectCard={selectCard}
          />
        )}

        {status === 'error' && view !== 'lists' && view !== 'watchlist' && (
          <EmptyState
            role="alert"
            icon="info"
            title="Couldn’t load the card catalog"
            action={
              <Button variant="primary" onClick={catalog.retry}>
                <Icon name="refresh" className="h-4 w-4" />
                Try again
              </Button>
            }
          >
            <p>{catalog.errorMessage}</p>
          </EmptyState>
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
        onRefresh={catalog.refresh}
        isRefreshing={catalog.isRefreshing}
        refreshError={catalog.refreshError}
        dataVersion={catalog.dataVersion}
        calcQty={selectedCard ? calc.qtyById.get(selectedCard.id) || 0 : 0}
        onCalcChange={calc.setQtyFor}
        watched={selectedCard ? watchlist.watchedIds.has(selectedCard.id) : false}
        onToggleWatch={watchlist.toggle}
        cards={cards}
      />

      <PdfToast job={pdfJob} raised={calcBarVisible} onClear={clearPdfJob} />
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
          saved={savedLists}
          currency={currency}
          rates={rates}
          onClose={closeCalc}
          onOpenCard={selectCard}
          onOpenSavedLists={openSavedLists}
          returnFocusRef={calcButtonRef}
        />
      )}
    </div>
  )
}

export default App
