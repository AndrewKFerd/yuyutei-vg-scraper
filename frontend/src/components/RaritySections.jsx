import { useCallback } from 'react'
import RarityBadge from './RarityBadge'
import CardGrid from './CardGrid'

// Single-set browsing view: instead of one flat (paginated) grid, group the
// set's cards into one block per rarity -- a set tops out around 300-400
// cards, small enough to show in full without pagination, and grouping by
// rarity makes it much easier to scan (e.g. "show me all the SECs") than
// hunting through print-run order. `allCards` (every card across the
// sections, in display order) is what the modal's previous/next walk.
function RaritySections({ sections, allCards, currency, rates, onSelect, qtyById, onToggle }) {
  // Stable, so typing elsewhere doesn't re-render every tile.
  const select = useCallback((card) => onSelect(card, allCards), [onSelect, allCards])
  if (sections.length === 0) return null

  return (
    <div className="flex flex-col gap-8">
      {sections.map(({ rarity, cards }) => (
        <section key={rarity || 'unknown'} aria-label={`${rarity || 'Unknown'} rarity`}>
          <h3 className="flex items-center gap-2 pb-2.5">
            <RarityBadge rarity={rarity} />
            <span className="text-sm font-semibold text-fg">{rarity || 'Unknown'}</span>
            <span className="text-xs text-fg-subtle">{cards.length.toLocaleString()}</span>
          </h3>
          <CardGrid
            cards={cards}
            currency={currency}
            rates={rates}
            onSelect={select}
            qtyById={qtyById}
            onToggle={onToggle}
          />
        </section>
      ))}
    </div>
  )
}

export default RaritySections
