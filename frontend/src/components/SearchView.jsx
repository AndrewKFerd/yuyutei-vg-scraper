import { useCallback, useEffect, useRef, useState } from 'react'
import { FilterSummary, SearchToolbar } from './SearchToolbar'
import CardGrid, { GridSkeleton } from './CardGrid'
import RaritySections from './RaritySections'
import Pagination from './Pagination'
import Icon from './icons'
import { EmptyMark } from './Logo'
import { Button, IconButton } from './controls'
import { prefersReducedMotion } from '../motion'
import { setLabel } from '../sets'
import { CONTAINER } from '../ui'

// The search view: the toolbar, a summary of what's shown, and the results
// -- paged across the whole catalog, or one set grouped by rarity. Its state
// is useSearch()'s, kept in App so the URL can mirror it.

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

/**
 * `search` is useSearch(); `status` the catalog's load state. Stays mounted
 * (just `hidden`) while another view shows, so switching back doesn't re-run
 * the search box's autofocus or reset the set filter's typed text.
 */
function SearchView({ search, status, hidden, currency, rates, calc, onSelect }) {
  const resultsRef = useRef(null)
  const [hintDone, setHintDone] = useState(readHintDone)
  const {
    deferredQuery,
    setSlug,
    rarity,
    sort,
    selectedSet,
    filteredCards,
    isSetSelected,
    isFiltered,
    page,
    totalPages,
    setPage,
    startIndex,
    pageCards,
  } = search

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

  const goToPage = (next) => {
    setPage(next)
    resultsRef.current?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }

  const query = deferredQuery.trim()
  const countLabel = filteredCards.length.toLocaleString()
  const cardsWord = filteredCards.length === 1 ? 'card' : 'cards'
  const summary =
    status !== 'ready'
      ? 'Loading cards…'
      : filteredCards.length === 0
        ? 'No matching cards'
        : isSetSelected
          ? `${countLabel} ${isFiltered && (query || rarity) ? 'matching ' : ''}${cardsWord}`
          : `Showing ${(startIndex + 1).toLocaleString()}–${(startIndex + pageCards.length).toLocaleString()} of ${countLabel} ${isFiltered ? 'matching ' : ''}${cardsWord}`

  return (
    <div hidden={hidden} className={`${CONTAINER} pt-5`}>
      <SearchToolbar
        query={search.query}
        onQueryChange={search.setQuery}
        setOptions={search.setOptions}
        setSlug={setSlug}
        onSetChange={search.setSetSlug}
        rarityOptions={search.rarityOptions}
        rarity={rarity}
        onRarityChange={search.setRarity}
        sort={sort}
        onSortChange={search.setSort}
      />

      <div ref={resultsRef} className="scroll-mt-4 pb-4 pt-4">
        <FilterSummary
          summary={summary}
          set={selectedSet}
          rarity={rarity}
          sort={sort}
          query={query}
          onClearSet={() => search.setSetSlug('')}
          onClearRarity={() => search.setRarity('')}
          onClearSort={() => search.setSort('default')}
          onClearAll={search.clearAll}
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
          <EmptyMark icon="search" />
          <p className="text-base font-semibold text-fg">{isFiltered ? 'No cards match' : 'The catalog is empty'}</p>
          {isFiltered && (
            <>
              <p className="text-sm text-fg-muted">
                {[query && `“${query}”`, selectedSet && `in ${setLabel(selectedSet)}`, rarity && `at ${rarity} rarity`]
                  .filter(Boolean)
                  .join(' ')}{' '}
                — try a shorter search or fewer filters.
              </p>
              <Button variant="primary" onClick={search.clearAll}>
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
            sections={search.raritySections}
            allCards={search.sectionCards}
            currency={currency}
            rates={rates}
            onSelect={onSelect}
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
            onSelect={onSelect}
            qtyById={calc.qtyById}
            onToggle={calc.toggle}
            className="pb-6"
          />
          <Pagination page={page} totalPages={totalPages} onChange={goToPage} />
        </>
      )}
    </div>
  )
}

export default SearchView
