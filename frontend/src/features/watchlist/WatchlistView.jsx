import { memo, useCallback, useMemo, useRef, useState } from 'react'
import RarityBadge from '../../ui/RarityBadge'
import DeltaChip from '../../ui/DeltaChip'
import Icon from '../../ui/icons'
import { CatalogErrorNote } from '../../ui/WarningNote'
import { EmptyMark } from '../../ui/Logo'
import { Button, IconButton } from '../../ui/controls'
import { formatPrice } from '../../lib/currency'
import { withCurrent } from '../../lib/catalogFormat'
import { imageUrl2x } from '../../lib/images'
import { stockInfo } from '../../lib/stock'
import { formatDateTime, plural, timeAgo } from '../../lib/format'
import { describeObservedAt } from '../../data/history'
import { focusSoon } from '../../ui/useDialogFocus'
import { CONTAINER, FIELD } from '../../ui/classes'

// The Watchlist view: watched cards, the ones that changed since they were
// last looked at first, each with what changed -- back in stock, a price
// move, its target price reached -- and the ups and downs in between from
// the price history. Marking a card as seen moves its baseline up to now.

/** @typedef {ReturnType<typeof import('./watchlistData.js').watchRow>} WatchRowData */

const yen = (n) => formatPrice(n, 'JPY', null)
// How many history events a row lists before "and N more".
const MAX_EVENTS = 4

const CHIPS = {
  target: { icon: 'check', text: 'Target reached', className: 'border-highlight-line bg-highlight text-fg' },
  restocked: { icon: 'restock', text: 'Back in stock', className: 'border-accent text-accent' },
  soldOut: { icon: 'soldOut', text: 'Sold out', className: 'border-line-strong text-negative' },
}

function ChangeChip({ kind }) {
  const chip = CHIPS[kind]
  if (!chip) return null
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${chip.className}`}>
      <Icon name={chip.icon} className="h-3.5 w-3.5" />
      {chip.text}
    </span>
  )
}

function eventText(event) {
  if (event.kind === 'restocked') return 'back in stock'
  if (event.kind === 'soldOut') return 'sold out'
  return `${yen(event.from)} → ${yen(event.to)}`
}

// "Since you last looked: sold out 1h ago · back in stock 3h ago · ¥1,200 →
// ¥980 2d ago", newest first.
function EventLine({ events, coverage }) {
  if (events.length === 0) return null
  const shown = events.slice(0, MAX_EVENTS)
  const more = events.length - shown.length
  return (
    <p className="text-xs text-fg-muted">
      <span className="font-medium text-fg">Since you last looked: </span>
      {shown.map((event, i) => (
        <span key={`${event.at}-${event.kind}`}>
          {i > 0 && ' · '}
          {eventText(event)}{' '}
          <span className="whitespace-nowrap text-fg-subtle" title={formatDateTime(event.at)}>
            {describeObservedAt(event.at, coverage)}
          </span>
        </span>
      ))}
      {more > 0 && ` · and ${plural(more, 'earlier change', 'earlier changes')}`}
    </p>
  )
}

// "Alert at ¥ [____]": the price at or under which the card counts as news
// (while in stock). Saved on blur or Enter; empty clears it.
function TargetField({ id, target, name, currency, rates, onCommit }) {
  const [draft, setDraft] = useState(null)
  const value = draft ?? (target === null ? '' : String(target))
  const commit = () => {
    if (draft === null) return
    onCommit(id, draft)
    setDraft(null)
  }
  return (
    <label className="flex items-center gap-2 text-xs text-fg-muted">
      <span className="whitespace-nowrap">Alert at or below</span>
      <span className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-subtle">
          ¥
        </span>
        <input
          type="text"
          inputMode="numeric"
          value={value}
          placeholder="any"
          aria-label={`Target price for ${name}, in yen`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape' && draft !== null) {
              e.stopPropagation()
              setDraft(null)
            }
          }}
          className={`${FIELD} h-8 w-28 pl-7 pr-3 tabular-nums`}
        />
      </span>
      {target !== null && currency !== 'JPY' && rates && (
        <span className="whitespace-nowrap text-fg-subtle">≈ {formatPrice(target, currency, rates)}</span>
      )}
    </label>
  )
}

// The card's art, or a placeholder for one that's no longer listed.
function Thumb({ card, inStock, name, onOpen }) {
  if (!card) {
    return (
      <div className="flex aspect-[100/140] w-14 shrink-0 items-center justify-center self-start rounded-md bg-surface-2 sm:w-16">
        <Icon name="info" className="h-5 w-5 text-fg-subtle" />
      </div>
    )
  }
  const url2x = imageUrl2x(card.imageUrl)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${name}`}
      className="aspect-[100/140] w-14 shrink-0 self-start overflow-hidden rounded-md bg-surface-2 sm:w-16"
    >
      <img
        src={card.imageUrl}
        srcSet={url2x ? `${card.imageUrl} 1x, ${url2x} 2x` : undefined}
        alt=""
        loading="lazy"
        decoding="async"
        className={`h-full w-full object-cover ${inStock ? '' : 'opacity-70 saturate-[.35]'}`}
      />
    </button>
  )
}

// Price now, with the move since it was last seen ("▼6% ¥7,980 / was ¥8,480").
function RowPrice({ seenPrice, nowPrice, currency, rates }) {
  const price = (n) => (n === null ? '—' : formatPrice(n, currency, rates))
  const moved = seenPrice !== null && nowPrice !== null && nowPrice !== seenPrice
  return (
    <div className="text-right">
      <p className="flex items-center justify-end gap-1.5">
        {moved && <DeltaChip from={seenPrice} to={nowPrice} period="since you last looked" />}
        <span className="text-lg font-bold tabular-nums text-accent">{price(nowPrice)}</span>
      </p>
      {moved && <p className="text-xs tabular-nums text-fg-subtle">was {price(seenPrice)}</p>}
    </div>
  )
}

// Stock-side changes as chips, plus a quiet one while a target is met that
// isn't news any more.
function RowBadges({ changes, targetMet }) {
  const quietTarget = targetMet && !changes.includes('target')
  if (changes.length === 0 && !quietTarget) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {changes.map((kind) => (
        <ChangeChip key={kind} kind={kind} />
      ))}
      {quietTarget && (
        <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs font-medium text-fg-muted">
          <Icon name="check" className="h-3.5 w-3.5" />
          At or below your target
        </span>
      )}
    </div>
  )
}

function calcButtonLabel(qty) {
  if (qty === 0) return 'Price list'
  if (qty === 1) return 'In price list'
  return `In price list ×${qty}`
}

const WatchRow = memo(
  /**
   * @param {{ row: WatchRowData, coverage: [number, number][] | undefined,
   *   currency: string, rates: object | null, calcQty: number, onSelect: (card: any) => void,
   *   onCalcChange: (card: any, qty: number) => void, onSetTarget: (id: string, value: string) => void,
   *   onSeen: (id: string) => void, onRemove: (id: string) => void }} props
   */
  function WatchRow({ row, coverage, currency, rates, calcQty, onSelect, onCalcChange, onSetTarget, onSeen, onRemove }) {
    const { item, card, now, changes, events, news, targetMet } = row
    const titleRef = useRef(null)
    const src = card || item.snap
    const name = src.nameEn || src.nameJp || src.setCode || 'card'
    const stock = now ? stockInfo(now.stock) : null
    // The modal gets this row's price and stock, which can be newer than
    // the cached catalog's.
    const open = () => card && onSelect(withCurrent(card, now.price, now.stock))
    const markSeen = () => {
      onSeen(item.id)
      // The button goes with the news; keep focus on this row.
      focusSoon(() => titleRef.current)
    }

    return (
      <li
        className={`flex gap-3 rounded-lg border bg-surface p-3 shadow-sm transition sm:gap-4 sm:p-4 ${
          news ? 'border-accent ring-1 ring-accent' : 'border-line'
        }`}
      >
        <Thumb card={card} inStock={stock?.inStock} name={name} onOpen={open} />

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <div className="min-w-0 flex-1 basis-48">
              <button
                ref={titleRef}
                type="button"
                onClick={open}
                disabled={!card}
                className="line-clamp-2 text-left text-sm font-semibold leading-snug text-fg enabled:hover:text-accent"
              >
                {name}
              </button>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                {src.setCode && <span className="font-mono">{src.setCode}</span>}
                {src.rarity && <RarityBadge rarity={src.rarity} />}
                {stock ? (
                  <span className={`font-medium ${stock.inStock ? 'text-positive' : 'text-negative'}`}>{stock.label}</span>
                ) : (
                  <span className="font-medium text-negative">No longer listed on yuyu-tei</span>
                )}
              </p>
            </div>
            {now && <RowPrice seenPrice={item.seen.price} nowPrice={now.price} currency={currency} rates={rates} />}
          </div>

          <RowBadges changes={changes} targetMet={targetMet} />
          <EventLine events={events} coverage={coverage} />

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {card && (
              <TargetField id={item.id} target={item.target} name={name} currency={currency} rates={rates} onCommit={onSetTarget} />
            )}
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              {news && (
                <Button size="sm" variant="ghost" onClick={markSeen}>
                  <Icon name="check" className="h-3.5 w-3.5" />
                  Mark seen
                </Button>
              )}
              {card && (
                <Button
                  size="sm"
                  aria-pressed={calcQty > 0}
                  onClick={() => onCalcChange(card, calcQty > 0 ? 0 : 1)}
                  className={calcQty > 0 ? 'border-accent text-accent' : ''}
                >
                  <Icon name={calcQty > 0 ? 'check' : 'plus'} className="h-3.5 w-3.5" />
                  {calcButtonLabel(calcQty)}
                </Button>
              )}
              <IconButton icon="close" size="sm" label={`Stop watching ${name}`} onClick={() => onRemove(item.id)} />
            </span>
          </div>
        </div>
      </li>
    )
  }
)

function summaryText(count, newsCount) {
  const news = newsCount > 0 ? `${plural(newsCount, 'has', 'have')} changed since you last looked` : 'nothing new since you last looked'
  return `${plural(count, 'card', 'cards')} · ${news}`
}

function EmptyWatchlist() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <EmptyMark icon="eye" />
      <p className="text-base font-semibold text-fg">Nothing watched yet</p>
      <p className="text-sm text-fg-muted">
        Open a card and press Watch, or watch every card in a saved list from its sheet. Come back later to see which
        ones restocked or changed price.
      </p>
    </div>
  )
}

/**
 * `watchlist` is useWatchlist(), `calc` useCalculator().
 */
function WatchlistView({ watchlist, calc, catalogStatus, onRetryCatalog, currency, rates, onSelectCard }) {
  const { rows, newsCount, history, asOf, remove, markSeen, setTarget } = watchlist
  const headingRef = useRef(null)
  const coverage = history?.coverage
  // The modal's previous/next walk the watched cards in this order.
  const cards = useMemo(() => rows.filter((row) => row.card).map((row) => row.card), [rows])
  const select = useCallback((card) => onSelectCard(card, cards), [onSelectCard, cards])
  // The hook's functions are stable, so these are too (WatchRow is memoized).
  const removeOne = useCallback(
    (id) => {
      remove(id)
      focusSoon(() => headingRef.current)
    },
    [remove]
  )
  const seenOne = useCallback((id) => markSeen([id]), [markSeen])
  const count = watchlist.items.length

  let body = null
  if (count === 0) body = <EmptyWatchlist />
  else if (catalogStatus === 'loading') body = <p className="py-10 text-center text-sm text-fg-muted">Loading the card catalog…</p>
  else if (catalogStatus === 'ready') {
    body = (
      <>
        <p className="mt-4 text-sm text-fg-muted" aria-live="polite">
          {summaryText(count, newsCount)}
          {asOf > 0 && (
            <>
              {' · prices from '}
              <span title={formatDateTime(asOf)}>{timeAgo(asOf)}</span>
            </>
          )}
        </p>
        <ul aria-labelledby="watchlist-title" className="mt-3 flex flex-col gap-2.5">
          {rows.map((row) => (
            <WatchRow
              key={row.item.id}
              row={row}
              coverage={coverage}
              currency={currency}
              rates={rates}
              calcQty={calc.qtyById.get(row.item.id) || 0}
              onSelect={select}
              onCalcChange={calc.setQtyFor}
              onSetTarget={setTarget}
              onSeen={seenOne}
              onRemove={removeOne}
            />
          ))}
        </ul>
        <p className="mt-3 text-xs text-fg-subtle">
          Changes are checked each time the prices refresh (about every 30 minutes while the price tracker runs). Target
          prices are in yen and count only while the card is in stock.
        </p>
      </>
    )
  }

  return (
    <div className={`${CONTAINER} pb-10 pt-5`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="watchlist-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold text-fg outline-none">
            Watchlist
          </h2>
          <p className="text-sm text-fg-muted">
            Cards you’re keeping an eye on. What changed since you last looked shows first: back in stock, price moves,
            and target prices reached. Kept in this browser only.
          </p>
        </div>
        {newsCount > 0 && (
          <Button variant="primary" onClick={() => markSeen()}>
            <Icon name="check" className="h-4 w-4" />
            Mark all as seen
          </Button>
        )}
      </div>

      {catalogStatus === 'error' && (
        <CatalogErrorNote onRetry={onRetryCatalog}>Couldn’t load the card catalog, so prices aren’t shown.</CatalogErrorNote>
      )}

      {body}
    </div>
  )
}

export default WatchlistView
