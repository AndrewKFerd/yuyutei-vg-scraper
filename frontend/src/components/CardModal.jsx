import { useCallback, useEffect, useState } from 'react'
import RarityBadge from './RarityBadge'
import { formatPrice } from '../currency'
import { imageUrl2x, imageUrlHd } from '../images'
import { stockInfo } from '../stock'

// Full-screen view of the 500x700 scan. Tap/click anywhere or press Escape
// to dismiss. Sits above the card modal (z-60 vs 50) and stops propagation
// so closing it doesn't also close the modal beneath.
function Lightbox({ src, alt, onClose }) {
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
      role="presentation"
      onMouseDown={(e) => {
        e.stopPropagation()
        onClose()
      }}
      className="fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-night-950/90 p-3"
    >
      <img src={src} alt={alt} className="max-h-full max-w-full rounded-md object-contain shadow-2xl" />
      <button
        type="button"
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

function SkillText({ card }) {
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

function CardModal({ card, currency, rates, onClose }) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const closeLightbox = useCallback(() => setLightboxOpen(false), [])
  // Which scan the modal thumbnail is showing: start with the 500x700
  // "front" scan; if the CDN doesn't have one for this card, fall back to
  // the 2x thumbnail rather than a broken image.
  const [hdFailed, setHdFailed] = useState(false)
  // Collapsed by default -- a full ability text can run to a dozen lines,
  // which used to push the sticky footer (price/stock/outbound link) far
  // enough down that reaching it meant scrolling past a wall of text first.
  const [skillOpen, setSkillOpen] = useState(false)

  // Reset per card so a previous card's fallback/lightbox/skill state doesn't leak.
  useEffect(() => {
    setLightboxOpen(false)
    setHdFailed(false)
    setSkillOpen(false)
  }, [card])

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
        role="dialog"
        aria-modal="true"
        aria-label={card.nameEn || card.nameJp}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-night-800"
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
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            aria-label="View full-size card image"
            title="View full size"
            className="group relative aspect-[100/140] w-36 max-h-[38vh] cursor-zoom-in self-center overflow-hidden rounded-md bg-slate-100 sm:w-full dark:bg-night-700 sm:max-h-none sm:self-auto"
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
              <StatPill value={card.kind} />
              <StatPill value={card.clan} />
              <StatPill value={card.grade != null ? `Grade ${card.grade}` : null} />
              <StatPill value={card.power != null ? `Power ${card.power}` : null} />
              <StatPill value={card.shield != null ? `Shield ${card.shield}` : null} />
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
              {skillOpen && <SkillText card={card} />}
            </div>

            {card.flavorEn ? (
              <p className="whitespace-pre-line text-xs italic leading-relaxed text-slate-500 dark:text-gold-500/60">
                {card.flavorEn}
              </p>
            ) : (
              card.flavorJp && (
                <p lang="ja" className="text-xs italic leading-relaxed text-slate-500 dark:text-gold-500/60">
                  {card.flavorJp}
                </p>
              )
            )}

            {/* Wiki text is CC BY-SA -- credit and link the source page. */}
            {card.translationSource === 'fandom' && (
              <p className="text-[11px] text-slate-400 dark:text-gold-500/50">
                English name and text: fan translation from the{' '}
                <a
                  href={wikiUrl(card.wikiTitle || card.nameEn)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-slate-600 dark:hover:text-gold-500"
                >
                  Cardfight!! Vanguard Wiki
                </a>{' '}
                (CC BY-SA).
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 sm:px-6 dark:border-night-600">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-brand-700 dark:text-brand-400">{displayPrice}</span>
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
