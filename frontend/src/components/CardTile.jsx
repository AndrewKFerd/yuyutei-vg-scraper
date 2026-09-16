import { memo } from 'react'
import RarityBadge from './RarityBadge'
import { formatPrice } from '../currency'
import { imageUrl2x } from '../images'

function CardTile({ card, currency, rates, onSelect }) {
  const inStock = card.stock > 0
  const url2x = imageUrl2x(card.imageUrl)
  const displayPrice =
    currency && currency !== 'JPY' ? formatPrice(card.price, currency, rates) : card.priceDisplay

  return (
    <button
      type="button"
      onClick={() => onSelect(card)}
      title={card.nameEn || card.nameJp}
      className={`group flex flex-col overflow-hidden rounded-md border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md hover:shadow-brand-100 dark:border-night-600 dark:bg-night-800 dark:hover:border-brand-500 dark:hover:shadow-brand-900/40 ${
        inStock ? '' : 'opacity-60 hover:opacity-90'
      }`}
    >
      <div className="relative aspect-[100/140] w-full overflow-hidden bg-slate-100 dark:bg-night-700">
        <img
          src={card.imageUrl}
          // Phones are 2-3x DPR, so the 100px thumbnail alone renders soft;
          // let the browser pick the 200px scan there and keep the small one
          // for 1x screens.
          srcSet={url2x ? `${card.imageUrl} 1x, ${url2x} 2x` : undefined}
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
        <span className="truncate font-mono text-[11px] text-slate-500 dark:text-gold-500/60">
          {card.setCode}
        </span>
        <span className="line-clamp-2 text-xs font-medium leading-snug text-slate-800 dark:text-gold-500">
          {card.nameEn || card.nameJp}
        </span>
        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="text-sm font-bold text-brand-700 dark:text-brand-400">{displayPrice}</span>
          <span
            className={`text-[11px] font-semibold ${
              inStock ? 'text-green-600' : 'text-red-500'
            }`}
          >
            {inStock ? `Stock: ${card.stock}` : 'Out of stock'}
          </span>
        </div>
      </div>
    </button>
  )
}

// Cards are immutable once fetched, so a shallow prop comparison on `card`
// is enough to keep unrelated tiles from re-rendering while the user types.
export default memo(CardTile)
