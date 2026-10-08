import { memo } from 'react'
import RarityBadge from './RarityBadge'
import DeltaChip from './DeltaChip'
import { formatPrice } from '../currency'
import { imageUrl2x } from '../images'
import { stockInfo } from '../stock'

// `delta` ({from, to, period?}) and `caption` are for the Movers view: the
// change over the selected window (overrides the card's own 7-day chg7d
// chip; `null` means no chip at all) and a short note under the price
// ("+2 printings", "Sold 6"). Callers must pass a memoized `delta` object --
// a fresh one per render would defeat memo() below and re-render every tile.
//
// `selectedQty` (0 = not in the price calculator) and `onToggle` drive the
// round add/remove button over the art. Pass a number and a stable callback,
// never the calculator's Map: either would re-render every tile on each toggle.
function CardTile({ card, currency, rates, onSelect, delta, caption, selectedQty = 0, onToggle }) {
  const { inStock, label: stockLabel } = stockInfo(card.stock)
  const chip =
    delta !== undefined ? delta : card.chg7d ? { from: card.chg7d.from, to: card.price, period: '7 days' } : null
  const url2x = imageUrl2x(card.imageUrl)
  const displayPrice =
    currency && currency !== 'JPY' ? formatPrice(card.price, currency, rates) : card.priceDisplay

  const name = card.nameEn || card.nameJp
  const selected = selectedQty > 0
  const toggleLabel = selected
    ? `Remove ${name} from price calculator (${selectedQty} ${selectedQty === 1 ? 'copy' : 'copies'})`
    : `Add ${name} to price calculator`

  return (
    // The toggle can't live inside the card's button (nested buttons are
    // invalid), so both sit in this wrapper, which also carries the hover lift
    // so the toggle moves with the card.
    <div className="group relative transition hover:-translate-y-0.5">
      <button
        type="button"
        onClick={() => onSelect(card)}
        title={name}
        className={`flex h-full w-full flex-col overflow-hidden rounded-md border border-slate-200 bg-white text-left shadow-sm transition hover:border-brand-300 hover:shadow-md hover:shadow-brand-100 dark:border-night-600 dark:bg-night-800 dark:hover:border-brand-500 dark:hover:shadow-brand-900/40 ${
          inStock ? '' : 'opacity-60 hover:opacity-90'
        } ${selected ? 'ring-2 ring-brand-500 dark:ring-brand-400' : ''}`}
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
          {chip && (
            <div className="absolute right-1 top-1">
              <DeltaChip from={chip.from} to={chip.to} period={chip.period} variant="overlay" />
            </div>
          )}
          {/* pr-10 centers the label in the space left of the calculator
              toggle, which sits over this bar's right end. */}
          {!inStock && (
            <div className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 pl-1 pr-10 text-center text-[10px] font-semibold uppercase tracking-wide text-white">
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
              {stockLabel}
            </span>
          </div>
          {caption && (
            <span className="truncate text-[11px] font-medium text-slate-500 dark:text-gold-500/70">{caption}</span>
          )}
        </div>
      </button>
      {/* Same box as the art (inside the 1px border) so the toggle can anchor
          to its corner; only the button itself takes clicks. Same spot on
          every tile, in stock or not -- it sits over the right end of the
          "Out of stock" bar, whose label is shifted left to make room. */}
      <div className="pointer-events-none absolute inset-x-px top-px aspect-[100/140]">
        <button
          type="button"
          onClick={() => onToggle(card)}
          aria-label={toggleLabel}
          title={toggleLabel}
          className={`pointer-events-auto absolute bottom-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold tabular-nums shadow-sm transition ${
            selected
              ? 'bg-brand-600 text-white ring-2 ring-white dark:bg-brand-500 dark:text-night-950 dark:ring-night-900'
              : 'bg-white/90 text-slate-700 ring-1 ring-slate-300 hover:bg-white hover:text-brand-700 dark:bg-night-900/85 dark:text-gold-500 dark:ring-night-600 dark:hover:text-brand-400'
          }`}
        >
          {!selected ? (
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
            </svg>
          ) : selectedQty === 1 ? (
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" />
            </svg>
          ) : selectedQty < 10 ? (
            `×${selectedQty}`
          ) : (
            selectedQty
          )}
        </button>
      </div>
    </div>
  )
}

// Cards are immutable once fetched, so a shallow prop comparison on `card`
// (plus the stable `delta`/`caption` the Movers view passes, and the
// primitive `selectedQty` / stable `onToggle`) is enough to keep unrelated
// tiles from re-rendering while the user types or toggles another card.
export default memo(CardTile)
