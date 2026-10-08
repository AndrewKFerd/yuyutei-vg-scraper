import { useEffect, useRef, useState } from 'react'
import RarityBadge from './RarityBadge'
import QtyStepper from './QtyStepper'
import { formatPrice } from '../currency'
import { formatListAsText } from '../useCalculator'
import { useDialogFocus } from '../useDialogFocus'

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`
const nameOf = (line) => line.nameEn || line.nameJp || line.setCode || 'card'

// Total in the display currency, then (when converted) the JPY it came from.
function useTotalText(totals, currency, rates) {
  const converted = currency !== 'JPY' && Boolean(rates)
  return {
    main: formatPrice(totals.totalJpy, currency, rates),
    jpy: converted ? formatPrice(totals.totalJpy, 'JPY', null) : null,
  }
}

/**
 * Sticky summary of the price calculator: card/copy counts and the total,
 * plus Undo for the last removal. Mounted from the first card added; the
 * live region stays mounted even while the bar is hidden, since a region
 * inserted together with its text is often not announced.
 */
function CalculatorBar({ calc, currency, rates, panelOpen, onOpenPanel, buttonRef }) {
  const { totals, undoInfo, message } = calc
  const total = useTotalText(totals, currency, rates)
  const hasItems = totals.cards > 0
  // Stays up while the panel is open (even if the list was just emptied) so
  // "View list" exists for focus to return to.
  const visible = hasItems || Boolean(undoInfo) || panelOpen

  const announcement = message
    ? message.kind === 'full' || totals.cards === 0
      ? message.text
      : `${message.text} — ${plural(totals.cards, 'card', 'cards')}, ${total.main}`
    : ''

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {visible && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-2.5 shadow-lg backdrop-blur dark:border-night-600 dark:bg-night-800/95">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-gold-500/70">
                {undoInfo ? (
                  <>
                    <span className="truncate">{undoInfo.label}</span>
                    <button
                      type="button"
                      onClick={calc.undo}
                      className="shrink-0 text-xs font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
                    >
                      Undo
                    </button>
                  </>
                ) : message?.kind === 'full' ? (
                  <span className="truncate font-semibold text-amber-600 dark:text-amber-400">{message.text}</span>
                ) : (
                  <span className="truncate">
                    {plural(totals.cards, 'card', 'cards')} · {plural(totals.copies, 'copy', 'copies')}
                    {totals.issues > 0 && (
                      <span className="text-amber-600 dark:text-amber-400">
                        {' '}
                        · ⚠ {plural(totals.issues, 'issue', 'issues')}
                      </span>
                    )}
                  </span>
                )}
              </div>
              {hasItems && (
                <div className="flex items-baseline gap-2 truncate">
                  <span className="text-lg font-bold tabular-nums text-brand-700 dark:text-brand-400">{total.main}</span>
                  {total.jpy && <span className="text-xs text-slate-500 dark:text-gold-500/70">{total.jpy}</span>}
                </div>
              )}
            </div>
            <button
                ref={buttonRef}
                type="button"
                onClick={onOpenPanel}
                aria-expanded={panelOpen}
                aria-controls="calc-panel"
                className="shrink-0 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 dark:bg-brand-500 dark:text-night-950 dark:hover:bg-brand-400"
              >
                View list
              </button>
          </div>
        </div>
      )}
    </>
  )
}

const WARNINGS = {
  oos: ['Out of stock', 'text-red-600 dark:text-red-400'],
  noprice: ['No price — not counted', 'text-slate-500 dark:text-gold-500/70'],
  unlisted: ['No longer listed — last known price', 'text-amber-600 dark:text-amber-400'],
}

function lineWarnings(line) {
  const out = []
  for (const flag of line.flags) {
    if (flag === 'over') out.push([`Only ${line.stock} in stock`, 'text-amber-600 dark:text-amber-400'])
    else out.push(WARNINGS[flag])
  }
  return out
}

function CalcRow({ line, currency, rates, calc, onOpenCard }) {
  const name = nameOf(line)
  const warnings = lineWarnings(line)
  return (
    <li className="flex items-start gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 dark:border-night-600">
      <button
        type="button"
        onClick={() => onOpenCard(line.card)}
        disabled={!line.card}
        aria-label={`Open ${name}`}
        className="h-14 w-10 shrink-0 overflow-hidden rounded bg-slate-100 enabled:hover:ring-2 enabled:hover:ring-brand-400 dark:bg-night-700"
      >
        {line.imageUrl && <img src={line.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mono text-[11px] text-slate-500 dark:text-gold-500/60">{line.setCode}</span>
          <RarityBadge rarity={line.rarity} />
        </div>
        <p className="line-clamp-1 text-sm font-medium text-slate-800 dark:text-gold-500">{name}</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-gold-500/70">{formatPrice(line.price, currency, rates)}</span>
            <QtyStepper value={line.qty} onChange={(n) => calc.setQty(line.id, n)} label={name} />
          </span>
          <span className="ml-auto text-sm font-bold tabular-nums text-brand-700 dark:text-brand-400">
            {formatPrice(line.lineJpy, currency, rates)}
          </span>
        </div>
        {warnings.map(([text, cls]) => (
          <p key={text} className={`mt-0.5 text-[11px] font-semibold ${cls}`}>
            {text}
          </p>
        ))}
      </div>
      <button
        type="button"
        onClick={() => calc.remove(line.id)}
        aria-label={`Remove ${name}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-red-600 dark:text-gold-500/70 dark:hover:bg-night-700 dark:hover:text-red-400"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
          <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
        </svg>
      </button>
    </li>
  )
}

/**
 * The full list as a bottom sheet (phones) / floating card (desktop).
 * `suspended` while a card modal is open on top of it: both listen for
 * Escape on the document, so without it one press would close both, and
 * both would trap Tab.
 */
export function CalculatorPanel({ calc, currency, rates, onClose, onOpenCard, suspended, returnFocusRef }) {
  const { lines, totals, undoInfo } = calc
  const sheetRef = useRef(null)
  const [copyState, setCopyState] = useState(null) // null | 'copied' | 'failed'
  const copyTimer = useRef(null)
  const total = useTotalText(totals, currency, rates)
  useDialogFocus(sheetRef, { open: true, trap: !suspended })

  useEffect(() => {
    if (suspended) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [suspended, onClose])

  // Same lock/restore pattern as CardModal, so nested ones unwind in order.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  // Declared after useDialogFocus so, on unmount, this runs last and wins:
  // some browsers don't focus a button on click, so "whatever had focus
  // before" may not be "View list".
  useEffect(() => {
    const button = returnFocusRef?.current
    return () => button?.focus({ preventScroll: true })
  }, [returnFocusRef])

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const copyList = async () => {
    let state = 'copied'
    try {
      await navigator.clipboard.writeText(formatListAsText(lines, totals, currency, rates))
    } catch {
      state = 'failed'
    }
    setCopyState(state)
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopyState(null), 2000)
  }

  const showBuyable = totals.issues > 0 && totals.buyableJpy !== totals.totalJpy

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-40 bg-slate-900/50 dark:bg-night-950/70"
    >
      <div
        ref={sheetRef}
        id="calc-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calc-title"
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-xl bg-white shadow-xl outline-none sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[30rem] sm:rounded-xl dark:bg-night-800"
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1 pl-4 pr-2 dark:border-night-600">
          <h2 id="calc-title" className="text-base font-bold text-slate-900 dark:text-gold-500">
            Price calculator{' '}
            <span className="text-xs font-normal text-slate-500 dark:text-gold-500/70">
              ({plural(totals.cards, 'card', 'cards')})
            </span>
          </h2>
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

        {lines.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500 dark:text-gold-500/70">
            <p>Your list is empty.</p>
            {undoInfo && (
              <button
                type="button"
                onClick={calc.undo}
                className="mt-2 text-sm font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
              >
                Undo — {undoInfo.label}
              </button>
            )}
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {lines.map((line) => (
              <CalcRow key={line.id} line={line} currency={currency} rates={rates} calc={calc} onOpenCard={onOpenCard} />
            ))}
          </ul>
        )}

        {lines.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 dark:border-night-600">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-slate-700 dark:text-gold-500">
                Total ({plural(totals.copies, 'copy', 'copies')})
              </span>
              <span className="flex items-baseline gap-2">
                <span className="text-lg font-bold tabular-nums text-brand-700 dark:text-brand-400">{total.main}</span>
                {total.jpy && <span className="text-xs text-slate-500 dark:text-gold-500/70">{total.jpy}</span>}
              </span>
            </div>
            {showBuyable && (
              <div className="text-xs text-slate-600 dark:text-gold-500/80">
                <span className="font-semibold">
                  Buyable now: {formatPrice(totals.buyableJpy, currency, rates)}
                </span>
                <span className="block text-[11px] text-slate-500 dark:text-gold-500/60">
                  Excludes out-of-stock and unlisted cards, and copies beyond stock.
                </span>
              </div>
            )}
            <p className="text-[11px] text-slate-400 dark:text-gold-500/50">
              Prices from yuyu-tei, shipping not included; conversions approximate.
            </p>
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={copyList}
                className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 dark:bg-brand-500 dark:text-night-950 dark:hover:bg-brand-400"
              >
                {copyState === 'copied' ? 'Copied!' : copyState === 'failed' ? 'Copy failed' : 'Copy list'}
              </button>
              <button
                type="button"
                onClick={calc.clear}
                className="text-sm font-medium text-red-600 underline-offset-2 hover:underline dark:text-red-400"
              >
                Clear all
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default CalculatorBar
