import { useCallback, useEffect, useRef, useState } from 'react'
import RarityBadge from './RarityBadge'
import DeltaChip from './DeltaChip'
import PriceHistoryChart from './PriceHistoryChart'
import { formatPrice } from '../currency'
import {
  describeChangeTime,
  formatDate,
  formatDateTime,
  formatPctSigned,
  getSeries,
  isoToMinute,
  loadHistory,
  newerThanCatalog,
  pctChange,
  summarizeSeries,
} from '../history'
import { imageUrl2x, imageUrlHd } from '../images'
import { loadSetDetails, reloadSetDetailsIfCached } from '../details'
import { stockInfo } from '../stock'
import { useDialogFocus } from '../useDialogFocus'

// Full-screen view of the 500x700 scan. Tap/click anywhere, press Escape or
// activate the close button to dismiss. Sits above the card modal (z-60 vs
// 50) and stops propagation so closing it doesn't also close the modal
// beneath. Owns keyboard focus while open; closing returns it to the
// "enlarge" button.
function Lightbox({ src, alt, onClose }) {
  const ref = useRef(null)
  useDialogFocus(ref, { open: true })

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    // Capture phase so this runs before the modal's own Escape handler.
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} — full-size image`}
      tabIndex={-1}
      onMouseDown={(e) => {
        e.stopPropagation()
        onClose()
      }}
      className="fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-night-950/90 p-3 outline-none"
    >
      <img src={src} alt={alt} className="max-h-full max-w-full rounded-md object-contain shadow-2xl" />
      {/* Pointer users already closed it on mousedown above; onClick is
          for keyboard activation (Enter/Space fire click, not mousedown). */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close full-size image"
        className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-night-800/80 text-gold-500 hover:bg-night-700"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
        </svg>
      </button>
    </div>
  )
}

// Page title -> URL on a fixed host, so dataset content can't redirect the link elsewhere.
function wikiUrl(title) {
  return `https://cardfight.fandom.com/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
}

// Small "Grade 3" / "Power 13000" style pills next to the rarity badge.
// Filled from the official English match, the wiki fan translation, or the
// yuyu-tei detail scrape, in that order (see pipeline/build-data.js) --
// null/undefined when none had it, in which case the pill isn't rendered.
function StatPill({ value }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-night-700 dark:text-gold-500">
      {value}
    </span>
  )
}

// `card` is the catalog card merged with its set's detail shard. `status` is
// that shard's load state: the skill text only exists in the shard, so
// "no skill text" must not be claimed until it has actually loaded.
function SkillText({ card, status, onRetry }) {
  if (status === 'loading') {
    return <p className="animate-pulse text-sm text-slate-400 dark:text-gold-500/50">Loading skill text…</p>
  }
  if (status === 'error') {
    return (
      <p
        role="alert"
        className="rounded-md border border-dashed border-red-300 p-3 text-sm text-red-600 dark:border-red-400/40 dark:text-red-400"
      >
        Couldn&apos;t load the skill text.{' '}
        <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">
          Retry
        </button>
      </p>
    )
  }

  if (card.skillTextEn) {
    return (
      <div className="rounded-md border border-gold-300 bg-gold-50 p-3 text-sm leading-relaxed whitespace-pre-line text-slate-800 dark:border-gold-700/50 dark:bg-night-700 dark:text-gold-500">
        {card.skillTextEn}
      </div>
    )
  }

  if (card.skillTextJp) {
    return (
      <div>
        <div
          lang="ja"
          className="rounded-md border border-gold-300 bg-gold-50 p-3 text-sm leading-relaxed whitespace-pre-line text-slate-800 dark:border-gold-700/50 dark:bg-night-700 dark:text-gold-500"
        >
          {card.skillTextJp}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400 dark:text-gold-500/50">
          Japanese only — no official English release yet.
        </p>
      </div>
    )
  }

  return (
    <p className="rounded-md border border-dashed border-slate-200 p-3 text-sm italic text-slate-400 dark:border-night-600 dark:text-gold-500/50">
      No skill text available for this card yet.
    </p>
  )
}

// Shown when history recorded a change after the visitor's cached catalog
// was built, so the footer's price/stock (from that catalog) is out of date.
function StaleCatalogNote({ latest, catalogMinute, currency, rates, onRefresh, isRefreshing, refreshError }) {
  const [at, price, stock] = latest
  return (
    <div className="rounded-md border border-gold-300 bg-gold-50 px-3 py-2 text-xs leading-relaxed text-slate-700 dark:border-gold-700/50 dark:bg-night-700 dark:text-gold-500">
      <span className="font-semibold">Newer data:</span> {formatPrice(price, currency, rates)} ·{' '}
      {stockInfo(stock).label} as of {formatDateTime(at)} — the price and stock shown below are from your cached
      catalog ({formatDateTime(catalogMinute)}).{' '}
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="font-semibold text-brand-700 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 dark:text-brand-400 dark:disabled:text-night-500"
        >
          {isRefreshing ? 'Refreshing…' : 'Refresh now'}
        </button>
      )}
      {onRefresh && refreshError && (
        <span role="alert" className="mt-1 block text-red-600 dark:text-red-400">
          Refresh failed ({refreshError}).
        </span>
      )}
    </div>
  )
}

// "Price history" block. `history` is undefined while loading, null when
// the history file isn't available (then the section just doesn't show --
// history is an extra, never an error state), else history-public.json.
function PriceHistorySection({
  card,
  history,
  currency,
  rates,
  catalogGeneratedAt,
  onRefresh,
  isRefreshing,
  refreshError,
}) {
  if (history === undefined) {
    return <p className="animate-pulse text-xs text-slate-400 dark:text-gold-500/50">Loading price history…</p>
  }
  if (history === null) return null

  const heading = (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-gold-500/60">
      Price history
    </h3>
  )

  const series = getSeries(history, card.id)
  // Cards whose only entry is the tracking baseline are stripped from the
  // public file, so "absent" means "no change since tracking began".
  if (!series) {
    return (
      <section className="flex flex-col gap-1">
        {heading}
        <p className="text-xs text-slate-500 dark:text-gold-500/70">
          Price unchanged since tracking began ({formatDate(history.trackingSince, { year: true })}).
        </p>
      </section>
    )
  }

  const fmt = (p) => formatPrice(p, currency, rates)
  const { low, high, changes, lastChange, firstSeen } = summarizeSeries(series)
  const firstSeenLater = firstSeen > history.trackingSince
  // Drawing needs some width: a listing first seen in the latest run is a
  // single point in time, which reads better as text.
  const chartable = history.lastRun - firstSeen >= 60
  const lastPct = lastChange ? pctChange(lastChange.from, lastChange.to) : null
  const strong = 'font-semibold text-slate-700 dark:text-gold-500'
  const catalogMinute = isoToMinute(catalogGeneratedAt)
  const newer = newerThanCatalog(series, card, catalogMinute)

  return (
    <section className="flex flex-col gap-2">
      {newer && (
        <StaleCatalogNote
          latest={newer}
          catalogMinute={catalogMinute}
          currency={currency}
          rates={rates}
          onRefresh={onRefresh}
          isRefreshing={isRefreshing}
          refreshError={refreshError}
        />
      )}
      {chartable ? (
        <PriceHistoryChart
          key={card.id}
          series={series}
          coverage={history.coverage}
          lastRun={history.lastRun}
          currency={currency}
          rates={rates}
        />
      ) : (
        heading
      )}
      <div className="flex flex-col gap-0.5 text-xs text-slate-500 dark:text-gold-500/70">
        {changes > 0 ? (
          <p>
            Low <span className={strong}>{fmt(low)}</span> · High <span className={strong}>{fmt(high)}</span> ·{' '}
            {changes} {changes === 1 ? 'change' : 'changes'}
          </p>
        ) : (
          <p>
            No price changes since {firstSeenLater ? 'first seen' : 'tracking began'} (
            {formatDate(firstSeen, { year: true })}) · <span className={strong}>{fmt(low)}</span>
          </p>
        )}
        {lastChange && (
          <p>
            Last change{' '}
            {lastPct !== null && (
              <span
                className={`font-semibold ${
                  lastPct > 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                }`}
              >
                {formatPctSigned(lastPct)}
              </span>
            )}{' '}
            ({fmt(lastChange.from)} → {fmt(lastChange.to)}) · changed{' '}
            {describeChangeTime(lastChange.at, history.coverage)}
          </p>
        )}
        {firstSeenLater && changes > 0 && <p>First seen {formatDate(firstSeen, { year: true })}.</p>}
      </div>
    </section>
  )
}

// `catalogGeneratedAt` / `onRefresh` / `isRefreshing` / `refreshError` drive
// the "newer data than your cached catalog" note; `dataVersion` changes
// after a catalog refresh (which also drops the history cache) so history
// reloads.
function CardModal({
  card,
  currency,
  rates,
  onClose,
  catalogGeneratedAt,
  onRefresh,
  isRefreshing,
  refreshError,
  dataVersion,
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const closeLightbox = useCallback(() => setLightboxOpen(false), [])
  // Focus moves into the dialog on open and back to the tile on close; Tab
  // stays inside it -- except while the lightbox (its own trap) is open.
  const dialogRef = useRef(null)
  useDialogFocus(dialogRef, { open: Boolean(card), trap: Boolean(card) && !lightboxOpen })
  // Which scan the modal thumbnail is showing: start with the 500x700
  // "front" scan; if the CDN doesn't have one for this card, fall back to
  // the 2x thumbnail rather than a broken image.
  const [hdFailed, setHdFailed] = useState(false)
  // Collapsed by default -- a full ability text can run to a dozen lines,
  // which used to push the sticky footer (price/stock/outbound link) far
  // enough down that reaching it meant scrolling past a wall of text first.
  const [skillOpen, setSkillOpen] = useState(false)
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

  // Reset per card so a previous card's fallback/lightbox/skill state doesn't
  // leak. Keyed on the id, not the object: a catalog refresh swaps in a
  // fresh object for the same card, which shouldn't collapse what's open.
  const cardId = card?.id
  useEffect(() => {
    setLightboxOpen(false)
    setHdFailed(false)
    setSkillOpen(false)
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

  // Escape-to-close, and lock page scroll while the modal is open -- both
  // only need to be active while a card is actually selected.
  useEffect(() => {
    if (!card) return

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [card, onClose])

  if (!card) return null

  const detailStatus = detailState.slug === setSlug ? detailState.status : 'loading'
  // Catalog card + its shard entry. A missing entry (a card with no heavy
  // fields at all is simply absent from its shard) merges nothing.
  const full = detailStatus === 'ready' ? { ...card, ...detailState.cards[card.id] } : card

  const { inStock, label: stockLabel } = stockInfo(card.stock)
  const displayPrice =
    currency && currency !== 'JPY' ? formatPrice(card.price, currency, rates) : card.priceDisplay
  const hdSrc = imageUrlHd(card.imageUrl)
  const bigSrc = (!hdFailed && hdSrc) || imageUrl2x(card.imageUrl) || card.imageUrl
  const altText = card.nameEn || card.nameJp

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-night-950/75"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={card.nameEn || card.nameJp}
        tabIndex={-1}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl outline-none dark:bg-night-800"
      >
        {/* Scrollable content -- everything EXCEPT price/stock/the outbound
            link, which live in the sticky footer below instead. Card art
            plus (once scrape-card-detail.js is enabled) skill text can run
            taller than a phone's viewport, and on a real device that used
            to push the outbound link below the modal's own clipped edge --
            tapping where it visually should be actually hit the backdrop
            behind it (verified: elementFromPoint at the link's un-scrolled
            position returned the backdrop div, not the link), which just
            closed the modal instead of opening anything. Keeping this
            footer outside the scroll container means the link is always
            reachable regardless of how tall the content above it gets. */}
        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-5 sm:grid sm:grid-cols-[200px_1fr] sm:p-6">
          {/* shrink-0: in the phone (flex-col) layout, tall content below --
              e.g. the price history -- would otherwise squash the art into a
              thin strip. No-op in the sm: grid layout. */}
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            aria-label="View full-size card image"
            title="View full size"
            className="group relative aspect-[100/140] w-36 max-h-[38vh] shrink-0 cursor-zoom-in self-center overflow-hidden rounded-md bg-slate-100 sm:w-full dark:bg-night-700 sm:max-h-none sm:self-auto"
          >
            <img
              src={bigSrc}
              onError={() => {
                if (!hdFailed) setHdFailed(true)
              }}
              alt={altText}
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            />
            <div className="absolute left-1.5 top-1.5">
              <RarityBadge rarity={card.rarity} />
            </div>
            <span className="absolute bottom-1.5 right-1.5 rounded bg-night-950/70 px-1.5 py-0.5 text-[10px] font-medium text-gold-500 opacity-80 group-hover:opacity-100">
              Tap to enlarge
            </span>
          </button>

          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold leading-snug text-slate-900 dark:text-gold-500">
                  {card.nameEn || card.nameJp}
                </h2>
                {card.nameEn && card.nameJp && (
                  <p lang="ja" className="mt-0.5 text-sm text-slate-500 dark:text-gold-500/70">
                    {card.nameJp}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-gold-500/70 dark:hover:bg-night-700 dark:hover:text-gold-500"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                  <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
                </svg>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-slate-500 dark:text-gold-500/70">
              <span>{card.setCode}</span>
              <StatPill value={full.kind} />
              <StatPill value={full.clan} />
              <StatPill value={full.grade != null ? `Grade ${full.grade}` : null} />
              <StatPill value={full.power != null ? `Power ${full.power}` : null} />
              <StatPill value={full.shield != null ? `Shield ${full.shield}` : null} />
            </div>

            <div>
              <button
                type="button"
                onClick={() => setSkillOpen((open) => !open)}
                aria-expanded={skillOpen}
                className="flex w-full items-center gap-1 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 dark:text-gold-500/60 dark:hover:text-gold-500"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className={`h-3.5 w-3.5 shrink-0 transition-transform ${skillOpen ? 'rotate-90' : ''}`}
                >
                  <path d="M7.05 4.05a1 1 0 011.414 0l4.243 4.243a1 1 0 010 1.414L8.464 13.95a1 1 0 11-1.414-1.414L10.586 9 7.05 5.464a1 1 0 010-1.414z" />
                </svg>
                Skill {skillOpen ? '' : '(tap to show)'}
              </button>
              {skillOpen && <SkillText card={full} status={detailStatus} onRetry={retryDetails} />}
            </div>

            {full.flavorEn ? (
              <p className="whitespace-pre-line text-xs italic leading-relaxed text-slate-500 dark:text-gold-500/60">
                {full.flavorEn}
              </p>
            ) : (
              full.flavorJp && (
                <p lang="ja" className="text-xs italic leading-relaxed text-slate-500 dark:text-gold-500/60">
                  {full.flavorJp}
                </p>
              )
            )}

            {/* Wiki text is CC BY-SA -- credit and link the source page.
                Held back while the shard loads: wikiTitle (the exact page,
                when it differs from the name) only arrives with it. */}
            {card.translationSource === 'fandom' && detailStatus !== 'loading' && (
              <p className="text-[11px] text-slate-400 dark:text-gold-500/50">
                English name and text: fan translation from the{' '}
                <a
                  href={wikiUrl(full.wikiTitle || card.nameEn)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-slate-600 dark:hover:text-gold-500"
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

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 sm:px-6 dark:border-night-600">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5">
              <span className="text-xl font-bold text-brand-700 dark:text-brand-400">{displayPrice}</span>
              {card.chg7d && <DeltaChip from={card.chg7d.from} to={card.price} period="7 days" suffix="7d" />}
            </span>
            <span
              className={`text-xs font-semibold ${inStock ? 'text-green-600' : 'text-red-500'}`}
            >
              {stockLabel}
            </span>
          </div>

          {card.detailUrl && (
            <a
              href={card.detailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="-my-2 inline-block py-2 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              View original listing on Yuyu-tei ↗
            </a>
          )}
        </div>
      </div>

      {lightboxOpen && <Lightbox src={bigSrc} alt={altText} onClose={closeLightbox} />}
    </div>
  )
}

export default CardModal
