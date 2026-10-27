import { useCallback, useEffect, useRef, useState } from 'react'
import RarityBadge from '../../ui/RarityBadge'
import DeltaChip from '../../ui/DeltaChip'
import Lightbox from './Lightbox'
import PriceHistorySection from './PriceHistorySection'
import SkillText from './SkillText'
import Icon from '../../ui/icons'
import { Button, IconButton } from '../../ui/controls'
import { formatPrice } from '../../lib/currency'
import { loadHistory } from '../../data/history'
import { imageUrl2x, imageUrlHd } from '../../lib/images'
import { loadSetDetails, reloadSetDetailsIfCached } from '../../data/details'
import { stockInfo } from '../../lib/stock'
import { SECTION_HEADING } from '../../ui/classes'
import { focusSoon, useDialogFocus } from '../../ui/useDialogFocus'
import { useRulesTranslation } from './useRulesTranslation'
import QtyStepper from '../../ui/QtyStepper'

// Page title -> URL on a fixed host, so dataset content can't redirect the link elsewhere.
function wikiUrl(title) {
  return `https://cardfight.fandom.com/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
}

// Small "Grade 3" / "Power 13000" style pills next to the set code.
// Filled from the official English match, the wiki fan translation, or the
// yuyu-tei detail scrape, in that order (see pipeline/build-data.js) --
// null/undefined when none had it, in which case the pill isn't rendered.
function StatPill({ value }) {
  if (value === null || value === undefined || value === '') return null
  return <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-fg-muted">{value}</span>
}

// Footer control for the price list: add, or (once added) set the quantity
// / remove. Going past the card's stock is allowed -- the warning is just
// that -- since people buy for later or expect a restock.
function CalcControl({ card, qty, onChange }) {
  const name = card.nameEn || card.nameJp
  const stock = card.stock
  if (qty === 0) {
    return (
      <div data-calc-modal className="flex flex-col items-start gap-1 sm:items-end">
        <Button
          variant="primary"
          data-calc-add
          onClick={() => {
            onChange(card, 1)
            // This button is replaced by the stepper; keep focus in the control.
            focusSoon(() => document.querySelector('[data-calc-modal] button[aria-label^="Increase"]'))
          }}
        >
          <Icon name="plus" className="h-4 w-4" />
          Add to price list
        </Button>
        {stock === 0 && <span className="text-xs text-fg-muted">Out of stock — you can still add it</span>}
      </div>
    )
  }
  return (
    <div data-calc-modal className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <QtyStepper value={qty} onChange={(n) => onChange(card, n)} label={name} />
      <Button
        variant="danger"
        size="inline"
        onClick={() => {
          onChange(card, 0)
          focusSoon(() => document.querySelector('[data-calc-modal] [data-calc-add]'))
        }}
        className="px-1"
      >
        Remove
      </Button>
      {stock > 0 && qty > stock && <span className="text-xs font-semibold text-warning">Only {stock} in stock</span>}
    </div>
  )
}

// Arrow keys step between cards -- unless they're doing something else
// already (moving a text cursor, a select, the chart's own cursor).
function isArrowTargetBusy(e) {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return true
  const el = e.target
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

// `catalogGeneratedAt` / `onRefresh` / `isRefreshing` / `refreshError` drive
// the "newer data than your cached catalog" note; `dataVersion` changes
// after a catalog refresh (which also drops the history cache) so history
// reloads. `calcQty` / `onCalcChange(card, qty)` are the price list's
// quantity for this card and its setter (qty 0 removes). `onPrev` / `onNext`
// (null at either end, or when the card wasn't opened from a list) and
// `position` ({ index, total }) drive the previous/next controls. `watched`
// / `onToggleWatch(card)` are the watchlist's.
function CardModal({
  card,
  currency,
  rates,
  onClose,
  onPrev,
  onNext,
  position,
  catalogGeneratedAt,
  onRefresh,
  isRefreshing,
  refreshError,
  dataVersion,
  calcQty,
  onCalcChange,
  watched,
  onToggleWatch,
  cards,
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const closeLightbox = useCallback(() => setLightboxOpen(false), [])
  // Focus moves into the dialog on open and back to the tile on close; Tab
  // stays inside it -- except while the lightbox (its own trap) is open.
  const dialogRef = useRef(null)
  const scrollRef = useRef(null)
  useDialogFocus(dialogRef, { open: Boolean(card), trap: Boolean(card) && !lightboxOpen })
  // Which scan the modal thumbnail is showing: start with the 500x700
  // "front" scan; if the CDN doesn't have one for this card, fall back to
  // the 2x thumbnail rather than a broken image.
  const [hdFailed, setHdFailed] = useState(false)
  // undefined = not loaded yet; null = unavailable. Kept across cards: the
  // loader is memoized per session, so after the first open this resolves
  // straight away.
  const [history, setHistory] = useState(undefined)
  // The card's set shard (skill text, flavor, stats -- not in the slim
  // catalog). Tagged with the slug it was loaded for, so switching to a card
  // of another set reads as "loading" rather than showing the old set's data.
  const [detailState, setDetailState] = useState({ slug: null, status: 'loading', cards: null })
  const [detailTry, setDetailTry] = useState(0)
  const setSlug = card?.setSlug

  // Reset per card so a previous card's fallback/lightbox state doesn't
  // leak, and start each card at the top. Keyed on the id, not the object:
  // a catalog refresh swaps in a fresh object for the same card, which
  // shouldn't collapse what's open.
  const cardId = card?.id
  useEffect(() => {
    setLightboxOpen(false)
    setHdFailed(false)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [cardId])

  // History is fetched lazily, on the first modal open -- never on page
  // load, so visitors who only browse never download it.
  useEffect(() => {
    if (!card) return
    let cancelled = false
    loadHistory().then((h) => {
      if (!cancelled) setHistory(h)
    })
    return () => {
      cancelled = true
    }
  }, [card, dataVersion])

  // The set shard is fetched when a card opens (memoized per set, and cached
  // on disk, so most opens cost nothing). Re-runs after a catalog refresh
  // (dataVersion), which drops the cached shards, and on Retry.
  useEffect(() => {
    if (!setSlug) return
    let cancelled = false
    const load = async () => {
      let cards = await loadSetDetails(setSlug)
      // A card with no entry is normal when it has no text, but it is also
      // what a shard cached before the card existed looks like: once per
      // set, refetch bypassing the cache before concluding "no skill text".
      if (cardId && !cards[cardId]) {
        try {
          cards = (await reloadSetDetailsIfCached(setSlug)) || cards
        } catch {
          // offline etc.: the cached shard is still the best there is
        }
      }
      return cards
    }
    load().then(
      (cards) => {
        if (!cancelled) setDetailState({ slug: setSlug, status: 'ready', cards })
      },
      () => {
        if (!cancelled) setDetailState({ slug: setSlug, status: 'error', cards: null })
      }
    )
    return () => {
      cancelled = true
    }
  }, [setSlug, cardId, dataVersion, detailTry])

  const retryDetails = useCallback(() => {
    setDetailState({ slug: setSlug, status: 'loading', cards: null })
    setDetailTry((n) => n + 1)
  }, [setSlug])

  // Escape closes; ←/→ step to the previous/next card. Page scroll is
  // locked while the modal is open -- all only while a card is selected.
  useEffect(() => {
    if (!card) return

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && onPrev && !isArrowTargetBusy(e)) onPrev()
      else if (e.key === 'ArrowRight' && onNext && !isArrowTargetBusy(e)) onNext()
    }
    document.addEventListener('keydown', handleKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [card, onClose, onPrev, onNext])

  // Machine translation of Japanese-only rules text, which needs the shard.
  const shardEntry = card && detailState.slug === setSlug && detailState.status === 'ready' ? detailState.cards[card.id] : null
  const translation = useRulesTranslation(shardEntry ? { ...card, ...shardEntry } : null, cards)

  if (!card) return null

  // Japanese labels from the detail scrape, in English while translation is
  // on (once the translator has loaded).
  const term = (value) => (translation.on && translation.translateTerm ? translation.translateTerm(value) : value)
  const detailStatus = detailState.slug === setSlug ? detailState.status : 'loading'
  // Catalog card + its shard entry. A missing entry (a card with no heavy
  // fields at all is simply absent from its shard) merges nothing.
  const full = detailStatus === 'ready' ? { ...card, ...detailState.cards[card.id] } : card

  const { inStock, label: stockLabel } = stockInfo(card.stock)
  const displayPrice =
    currency && currency !== 'JPY' ? formatPrice(card.price, currency, rates) : card.priceDisplay
  const hdSrc = imageUrlHd(card.imageUrl)
  const bigSrc = (!hdFailed && hdSrc) || imageUrl2x(card.imageUrl) || card.imageUrl
  const name = card.nameEn || card.nameJp

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-slate-900/60 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 dark:bg-night-950/75"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-modal-title"
        tabIndex={-1}
        className="flex max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] w-full max-w-2xl animate-dialog flex-col overflow-hidden rounded-xl bg-surface shadow-xl outline-none"
      >
        {/* The height cap is in dvh where there is one: on a phone, 92vh is
            92% of the screen with the browser's toolbars hidden, so with
            them showing the centred modal overflowed both ends and lost its
            footer (the listing link) off the bottom. */}
        {/* Top bar: previous/next and close, outside the scrolling content
            so they never scroll out of reach (the same reason price, stock
            and the outbound link live in the pinned footer: on a phone,
            content scrolled past the modal's clipped edge leaves taps
            landing on the backdrop, which closes the modal instead). */}
        <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
          {position ? (
            <>
              {/* aria-disabled, not disabled: a button that disables itself
                  while focused (stepping onto the last card) drops focus. */}
              <IconButton
                icon="chevronLeft"
                label="Previous card"
                onClick={() => onPrev?.()}
                aria-disabled={!onPrev}
                className="aria-disabled:cursor-default aria-disabled:opacity-30"
              />
              <span className="min-w-16 text-center text-xs tabular-nums text-fg-muted">
                {(position.index + 1).toLocaleString()} of {position.total.toLocaleString()}
              </span>
              <IconButton
                icon="chevronRight"
                label="Next card"
                onClick={() => onNext?.()}
                aria-disabled={!onNext}
                className="aria-disabled:cursor-default aria-disabled:opacity-30"
              />
            </>
          ) : (
            <span className="px-2 font-mono text-xs text-fg-subtle">{card.setCode}</span>
          )}
          <Button
            size="sm"
            variant={watched ? 'secondary' : 'ghost'}
            aria-pressed={watched}
            onClick={() => onToggleWatch(card)}
            title={watched ? 'Stop watching this card' : 'Watch this card for restocks and price changes'}
            className={`ml-auto ${watched ? 'border-accent text-accent' : ''}`}
          >
            <Icon name="eye" className="h-4 w-4" />
            {watched ? 'Watching' : 'Watch'}
          </Button>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>

        <div ref={scrollRef} className="flex min-h-0 flex-col gap-5 overflow-y-auto p-5 sm:grid sm:grid-cols-[200px_1fr] sm:p-6">
          {/* shrink-0: in the phone (flex-col) layout, tall content below --
              e.g. the price history -- would otherwise squash the art into a
              thin strip. No-op in the sm: grid layout. */}
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            aria-label="View full-size card image"
            title="View full size"
            className="group relative aspect-[100/140] w-36 max-h-[38vh] shrink-0 cursor-zoom-in self-center overflow-hidden rounded-lg bg-surface-2 sm:w-full sm:max-h-none sm:self-auto"
          >
            <img
              src={bigSrc}
              onError={() => {
                if (!hdFailed) setHdFailed(true)
              }}
              alt={name}
              className="h-full w-full object-cover transition-transform duration-200 motion-safe:group-hover:scale-[1.02]"
            />
            <div className="absolute left-1.5 top-1.5">
              <RarityBadge rarity={card.rarity} />
            </div>
            <span className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-night-950/70 text-white opacity-80 transition group-hover:opacity-100">
              <Icon name="expand" className="h-4 w-4" />
            </span>
          </button>

          <div className="flex min-w-0 flex-col gap-4">
            <div>
              <h2 id="card-modal-title" className="text-xl font-bold leading-snug text-fg">
                {name}
              </h2>
              {card.nameEn && card.nameJp && (
                <p lang="ja" className="mt-0.5 text-sm text-fg-muted">
                  {card.nameJp}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs text-fg-muted">{card.setCode}</span>
                <StatPill value={term(full.kind)} />
                <StatPill value={term(full.clan)} />
                <StatPill value={full.grade != null ? `Grade ${full.grade}` : null} />
                <StatPill value={full.power != null ? `Power ${full.power}` : null} />
                <StatPill value={full.shield != null ? `Shield ${full.shield}` : null} />
              </div>
            </div>

            <section className="flex flex-col gap-1.5">
              <h3 className={SECTION_HEADING}>Skill</h3>
              <SkillText card={full} status={detailStatus} onRetry={retryDetails} translation={translation} />
            </section>

            {full.flavorEn ? (
              <p className="whitespace-pre-line text-sm italic leading-relaxed text-fg-muted">{full.flavorEn}</p>
            ) : (
              full.flavorJp && (
                <p lang="ja" className="text-sm italic leading-relaxed text-fg-muted">
                  {full.flavorJp}
                </p>
              )
            )}

            {/* Wiki text is CC BY-SA -- credit and link the source page.
                Held back while the shard loads: wikiTitle (the exact page,
                when it differs from the name) only arrives with it. */}
            {card.translationSource === 'fandom' && detailStatus !== 'loading' && (
              <p className="text-xs text-fg-subtle">
                English name and text: fan translation from the{' '}
                <a
                  href={wikiUrl(full.wikiTitle || card.nameEn)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-fg"
                >
                  Cardfight!! Vanguard Wiki
                </a>{' '}
                (CC BY-SA).
              </p>
            )}

            <PriceHistorySection
              card={card}
              history={history}
              currency={currency}
              rates={rates}
              catalogGeneratedAt={catalogGeneratedAt}
              onRefresh={onRefresh}
              isRefreshing={isRefreshing}
              refreshError={refreshError}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-line px-5 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1.5">
                <span className="text-2xl font-bold tabular-nums text-accent">{displayPrice}</span>
                {card.chg7d && <DeltaChip from={card.chg7d.from} to={card.price} period="7 days" suffix="7d" />}
              </span>
              <span className={`text-sm font-medium ${inStock ? 'text-positive' : 'text-negative'}`}>{stockLabel}</span>
            </div>

            <CalcControl card={card} qty={calcQty} onChange={onCalcChange} />
          </div>

          {card.detailUrl && (
            <a
              href={card.detailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="-my-2 inline-flex items-center gap-1 self-start py-2 text-xs font-medium text-accent hover:underline"
            >
              View original listing on Yuyu-tei
              <Icon name="external" className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>

      {lightboxOpen && <Lightbox src={bigSrc} alt={name} onClose={closeLightbox} />}
    </div>
  )
}

export default CardModal
