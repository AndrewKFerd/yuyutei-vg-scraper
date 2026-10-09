import { useId, useState } from 'react'
import SearchBar from './SearchBar'
import SetFilter from './SetFilter'
import RarityFilter from './RarityFilter'
import SortSelect from './SortSelect'
import Icon from './icons'
import { Button } from './controls'
import { setShortLabel } from '../sets'
import { SORT_OPTIONS } from '../sorting'

/**
 * Search box plus the set / rarity / sort filters. Wide screens show
 * everything in one or two rows; phones fold the filters behind a
 * "Filters" button (with a count of the active ones) so the grid starts on
 * the first screen.
 */
export function SearchToolbar({
  query,
  onQueryChange,
  setOptions,
  setSlug,
  onSetChange,
  rarityOptions,
  rarity,
  onRarityChange,
  sort,
  onSortChange,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const panelId = useId()
  const active = (setSlug ? 1 : 0) + (rarity ? 1 : 0) + (sort !== 'default' ? 1 : 0)

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
      <div className="flex gap-2 lg:flex-1">
        <SearchBar value={query} onChange={onQueryChange} className="min-w-0 flex-1" />
        <Button
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          aria-controls={panelId}
          className="h-11 shrink-0 sm:hidden"
        >
          <Icon name="filter" className="h-4 w-4" />
          Filters
          {active > 0 && (
            <span className="ml-0.5 rounded-full bg-accent-solid px-1.5 text-[11px] font-bold leading-5 text-on-accent">
              {active}
            </span>
          )}
        </Button>
      </div>
      <div
        id={panelId}
        className={`${filtersOpen ? 'grid' : 'hidden'} grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:flex-nowrap`}
      >
        <SetFilter options={setOptions} value={setSlug} onChange={onSetChange} className="col-span-2 sm:w-72" />
        <RarityFilter options={rarityOptions} value={rarity} onChange={onRarityChange} className="sm:w-40" />
        <SortSelect value={sort} onChange={onSortChange} className="sm:w-48" />
      </div>
    </div>
  )
}

function Chip({ children, onRemove, removeLabel }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full border border-line-strong bg-surface py-0.5 pl-2.5 pr-0.5 text-xs font-medium text-fg">
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        title={removeLabel}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-2 hover:text-fg"
      >
        <Icon name="close" className="h-3.5 w-3.5" />
      </button>
    </span>
  )
}

/**
 * "Showing 1–50 of 1,234 cards" plus one removable chip per active filter
 * and "Clear all", so what's narrowing the grid is always visible -- even
 * when the phone layout has the filters folded away.
 */
export function FilterSummary({ summary, set, rarity, sort, query, onClearSet, onClearRarity, onClearSort, onClearAll }) {
  const sortLabel = SORT_OPTIONS.find(([key]) => key === sort)?.[1]
  const anyFilter = Boolean(set || rarity || sort !== 'default' || query)
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
      <p className="text-sm text-fg-muted">
        {summary}
      </p>
      {(set || rarity || sort !== 'default') && (
        <div className="flex flex-wrap items-center gap-1.5">
          {set && (
            <Chip onRemove={onClearSet} removeLabel="Remove set filter">
              Set: {setShortLabel(set)}
            </Chip>
          )}
          {rarity && (
            <Chip onRemove={onClearRarity} removeLabel="Remove rarity filter">
              Rarity: {rarity}
            </Chip>
          )}
          {sort !== 'default' && (
            <Chip onRemove={onClearSort} removeLabel="Reset sort order">
              {sortLabel}
            </Chip>
          )}
        </div>
      )}
      {anyFilter && (
        <Button variant="link" size="inline" onClick={onClearAll}>
          Clear all
        </Button>
      )}
    </div>
  )
}
