import CardTile from './CardTile'

function CardGrid({ cards, currency, rates, onSelect }) {
  if (cards.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-slate-400">
        No cards match your search.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 px-4 pb-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
      {cards.map((card) => (
        <CardTile key={card.id} card={card} currency={currency} rates={rates} onSelect={onSelect} />
      ))}
    </div>
  )
}

export default CardGrid
