import { memo } from 'react'
import RarityBadge from './RarityBadge'

function CardTile({ card }) {
  const inStock = card.stock > 0

  return (
    <a
      href={card.detailUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={card.nameEn || card.nameJp}
      className={`group flex flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
        inStock ? '' : 'opacity-60 hover:opacity-90'
      }`}
    >
      <div className="relative aspect-[100/140] w-full overflow-hidden bg-slate-100">
        <img
          src={card.imageUrl}
          alt={card.nameEn || card.nameJp}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
        />
        <div className="absolute left-1 top-1">
          <RarityBadge rarity={card.rarity} />
        </div>
        {!inStock && (
          <div className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-white">
            Out of stock
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-2">
        <span className="truncate font-mono text-[11px] text-slate-500">
          {card.setCode}
        </span>
        <span className="line-clamp-2 text-xs font-medium leading-snug text-slate-800">
          {card.nameEn || card.nameJp}
        </span>
        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="text-sm font-bold text-blue-700">
            {card.priceDisplay}
          </span>
          <span
            className={`text-[11px] font-semibold ${
              inStock ? 'text-green-600' : 'text-red-500'
            }`}
          >
            {inStock ? `Stock: ${card.stock}` : 'Out of stock'}
          </span>
        </div>
      </div>
    </a>
  )
}

// Cards are immutable once fetched, so a shallow prop comparison on `card`
// is enough to keep unrelated tiles from re-rendering while the user types.
export default memo(CardTile)
