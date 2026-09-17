import RarityBadge from './RarityBadge'
import CardTile from './CardTile'

// Single-set browsing view: instead of one flat (paginated) grid, group the
// set's cards into one block per rarity -- a set tops out around 300-400
// cards, small enough to show in full without pagination, and grouping by
// rarity makes it much easier to scan (e.g. "show me all the SECs") than
// hunting through print-run order.
function RaritySections({ sections, currency, rates, onSelect }) {
  if (sections.length === 0) return null

  return (
    <div className="flex flex-col gap-6 pb-10">
      {sections.map(({ rarity, cards }) => (
        <section key={rarity || 'unknown'}>
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 pb-2">
            <RarityBadge rarity={rarity} />
            <span className="text-sm font-semibold text-slate-600 dark:text-gold-500">
              {rarity || 'Unknown'}
            </span>
            <span className="text-xs text-slate-400 dark:text-gold-500/50">
              ({cards.length.toLocaleString()})
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {cards.map((card) => (
              <CardTile key={card.id} card={card} currency={currency} rates={rates} onSelect={onSelect} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export default RaritySections
