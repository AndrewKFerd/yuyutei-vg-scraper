import { useCallback } from 'react'
import CardTile from './CardTile'
import { GRID } from '../ui'

// `onSelect(card, list)`: the list is what the card modal steps through
// with its previous/next buttons -- the cards shown alongside this one.
function CardGrid({ cards, currency, rates, onSelect, qtyById, onToggle, className = '' }) {
  const select = useCallback((card) => onSelect(card, cards), [onSelect, cards])
  return (
    <div className={`${GRID} ${className}`}>
      {cards.map((card) => (
        <CardTile
          key={card.id}
          card={card}
          currency={currency}
          rates={rates}
          onSelect={select}
          selectedQty={qtyById.get(card.id) || 0}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

/** Placeholder grid in the tiles' own shape (art, set code, name, price row). */
export function GridSkeleton({ count = 16, className = '' }) {
  return (
    <div aria-hidden="true" className={`${GRID} ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="aspect-[100/140] w-full animate-pulse bg-surface-2" />
          <div className="flex flex-col gap-1.5 p-2">
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-surface-2" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-surface-2" />
            <div className="mt-1 flex justify-between">
              <div className="h-3.5 w-1/3 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-1/4 animate-pulse rounded bg-surface-2" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default CardGrid
