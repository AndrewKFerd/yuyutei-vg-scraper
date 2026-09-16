import { useEffect } from 'react'
import RarityBadge from './RarityBadge'
import { formatPrice } from '../currency'

// Small "Grade 3" / "Power 13000" style pills next to the rarity badge.
// Only ever populated for cards with a verified official English match
// (see pipeline/match-official.js) -- null/undefined for everything else,
// in which case the pill is simply not rendered.
function StatPill({ value }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
      {value}
    </span>
  )
}

function SkillText({ card }) {
  if (card.skillTextEn) {
    return (
      <div className="rounded-md border border-gold-300 bg-gold-50 p-3 text-sm leading-relaxed whitespace-pre-line text-slate-800">
        {card.skillTextEn}
      </div>
    )
  }

  if (card.skillTextJp) {
    return (
      <div>
        <div
          lang="ja"
          className="rounded-md border border-gold-300 bg-gold-50 p-3 text-sm leading-relaxed whitespace-pre-line text-slate-800"
        >
          {card.skillTextJp}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">
          Japanese only — no official English release yet.
        </p>
      </div>
    )
  }

  return (
    <p className="rounded-md border border-dashed border-slate-200 p-3 text-sm italic text-slate-400">
      No skill text available for this card yet.
    </p>
  )
}

function CardModal({ card, currency, rates, onClose }) {
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

  const inStock = card.stock > 0
  const displayPrice =
    currency && currency !== 'JPY' ? formatPrice(card.price, currency, rates) : card.priceDisplay

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={card.nameEn || card.nameJp}
        className="grid max-h-[90vh] w-full max-w-2xl grid-cols-1 gap-5 overflow-y-auto rounded-lg bg-white p-5 shadow-xl sm:grid-cols-[200px_1fr] sm:p-6"
      >
        <div className="relative aspect-[100/140] w-full overflow-hidden rounded-md bg-slate-100">
          <img
            src={card.imageUrl}
            alt={card.nameEn || card.nameJp}
            className="h-full w-full object-cover"
          />
          <div className="absolute left-1.5 top-1.5">
            <RarityBadge rarity={card.rarity} />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold leading-snug text-slate-900">
                {card.nameEn || card.nameJp}
              </h2>
              {card.nameEn && card.nameJp && (
                <p lang="ja" className="mt-0.5 text-sm text-slate-500">
                  {card.nameJp}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
              </svg>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-slate-500">
            <span>{card.setCode}</span>
            <StatPill value={card.kind} />
            <StatPill value={card.clan} />
            <StatPill value={card.grade != null ? `Grade ${card.grade}` : null} />
            <StatPill value={card.power != null ? `Power ${card.power}` : null} />
            <StatPill value={card.shield != null ? `Shield ${card.shield}` : null} />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xl font-bold text-brand-700">{displayPrice}</span>
            <span
              className={`text-xs font-semibold ${inStock ? 'text-green-600' : 'text-red-500'}`}
            >
              {inStock ? `Stock: ${card.stock}` : 'Out of stock'}
            </span>
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Skill
            </h3>
            <SkillText card={card} />
          </div>

          {card.detailUrl && (
            <a
              href={card.detailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-auto text-xs font-medium text-brand-600 hover:underline"
            >
              View original listing on Yuyu-tei ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

export default CardModal
