import { memo } from 'react'
import RarityBadge from './RarityBadge'
import DeltaChip from './DeltaChip'
import Icon from './icons'
import { formatPrice } from '../currency'
import { imageUrl2x } from '../images'
import { stockInfo } from '../stock'

// `delta` ({from, to, period?}) and `caption` are for the Movers view: the
// change over the selected window (overrides the card's own 7-day chg7d
// chip; `null` means no chip at all) and a short note under the price
// ("+2 printings", "Sold 6"). Callers must pass a memoized `delta` object --
// a fresh one per render would defeat memo() below and re-render every tile.
//
// `selectedQty` (0 = not in the price list) and `onToggle` drive the round
// add/remove button over the art. Pass a number and a stable callback, never
// the calculator's Map: either would re-render every tile on each toggle.
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
    ? `Remove ${name} from price list (${selectedQty} ${selectedQty === 1 ? 'copy' : 'copies'})`
    : `Add ${name} to price list`

  return (
    // The toggle can't live inside the card's button (nested buttons are
    // invalid), so both sit in this wrapper, which also carries the hover lift
    // so the toggle moves with the card.
    <div className="group relative transition motion-safe:hover:-translate-y-0.5">
      <button
        type="button"
        onClick={() => onSelect(card)}
        title={name}
        className={`flex h-full w-full flex-col overflow-hidden rounded-lg border bg-surface text-left shadow-sm transition hover:shadow-md ${
          selected ? 'border-accent ring-2 ring-accent' : 'border-line hover:border-accent'
        }`}
      >
        <div className="relative aspect-[100/140] w-full overflow-hidden bg-surface-2">
          <img
            src={card.imageUrl}
            // Phones are 2-3x DPR, so the 100px thumbnail alone renders soft;
            // let the browser pick the 200px scan there and keep the small one
            // for 1x screens.
            srcSet={url2x ? `${card.imageUrl} 1x, ${url2x} 2x` : undefined}
            alt={name}
            loading="lazy"
            decoding="async"
            // Out of stock dims the art only, so the text below keeps its contrast.
            className={`h-full w-full object-cover transition duration-200 motion-safe:group-hover:scale-[1.03] ${
              inStock ? '' : 'opacity-70 saturate-[.35]'
            }`}
          />
          <div className="absolute left-1 top-1">
            <RarityBadge rarity={card.rarity} />
          </div>
          {chip && (
            <div className="absolute right-1 top-1">
              <DeltaChip from={chip.from} to={chip.to} period={chip.period} variant="overlay" />
            </div>
          )}
          {/* pr-10 centers the label in the space left of the price-list
              toggle, which sits over this bar's right end. */}
          {!inStock && (
            <div className="absolute inset-x-0 bottom-0 bg-black/70 py-1 pl-1 pr-10 text-center text-[10px] font-semibold uppercase tracking-wide text-white">
              Out of stock
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-0.5 p-2">
          <span className="truncate font-mono text-xs text-fg-subtle">{card.setCode}</span>
          <span className="line-clamp-2 text-[13px] font-medium leading-snug text-fg">{name}</span>
          <div className="mt-auto flex flex-wrap items-baseline justify-between gap-x-2 pt-1">
            <span className="text-sm font-bold tabular-nums text-accent">{displayPrice}</span>
            <span className={`text-xs font-medium ${inStock ? 'text-positive' : 'text-negative'}`}>{stockLabel}</span>
          </div>
          {caption && <span className="truncate text-xs text-fg-muted">{caption}</span>}
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
          className={`pointer-events-auto absolute bottom-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold tabular-nums shadow-md transition ${
            selected
              ? 'bg-accent-solid text-on-accent ring-2 ring-surface'
              : 'bg-surface/90 text-fg ring-1 ring-line-strong hover:bg-surface hover:text-accent'
          }`}
        >
          {!selected ? (
            <Icon name="plus" className="h-4 w-4" />
          ) : selectedQty === 1 ? (
            <Icon name="check" className="h-4 w-4" />
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
