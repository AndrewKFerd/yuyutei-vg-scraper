import { useEffect, useRef, useState } from 'react'
import RarityBadge from '../../ui/RarityBadge'
import QtyStepper from '../../ui/QtyStepper'
import SaveListForm from '../saved-lists/SaveListForm'
import { Button, IconButton } from '../../ui/controls'
import { BACKDROP } from '../../ui/classes'
import { formatPrice } from '../../lib/currency'
import { plural } from '../../lib/format'
import { formatListAsText } from './useCalculator'
import { defaultListName, saveResultText } from '../saved-lists/useSavedLists'
import { focusSoon } from '../../ui/useDialogFocus'
import { useModal } from '../../ui/useModal'

const nameOf = (line) => line.nameEn || line.nameJp || line.setCode || 'card'

// Total in the display currency, then (when converted) the JPY it came from.
function totalText(totals, currency, rates) {
  const converted = currency !== 'JPY' && Boolean(rates)
  return {
    main: formatPrice(totals.totalJpy, currency, rates),
    jpy: converted ? formatPrice(totals.totalJpy, 'JPY', null) : null,
  }
}

/**
 * Sticky summary of the price list (the "calculator" in code): card/copy counts and the total,
 * plus Undo for the last removal. Mounted from the first card added; the
 * live region stays mounted even while the bar is hidden, since a region
 * inserted together with its text is often not announced.
 */
function CalculatorBar({ calc, currency, rates, visible, panelOpen, onOpenPanel, buttonRef }) {
  const { totals, undoInfo, message } = calc
  const total = totalText(totals, currency, rates)
  const hasItems = totals.cards > 0
  // `visible` is decided once, in App; it stays true while the panel is open
  // (even if the list was just emptied) so "View list" exists for focus to
  // return to.

  // The announcement is built once per action and then frozen: rebuilding it
  // from live totals would re-announce "Added X" whenever the currency,
  // rates or a quantity field changed. (State set during render, keyed on
  // the message object, which is new for every action.)
  const [announced, setAnnounced] = useState({ message: null, text: '' })
  if (message && announced.message !== message) {
    const text =
      message.kind === 'full' || message.cards === 0
        ? message.text
        : `${message.text} — ${plural(message.cards, 'card', 'cards')}, ${formatPrice(message.totalJpy, currency, rates)}`
    setAnnounced({ message, text })
  }
  const announcement = announced.text

  // The total gives a small bump each time copies are added (not removed),
  // by remounting it keyed on a count of additions. Same render-time state
  // pattern as above.
  const [bump, setBump] = useState({ copies: totals.copies, n: 0 })
  if (bump.copies !== totals.copies) {
    setBump({ copies: totals.copies, n: totals.copies > bump.copies ? bump.n + 1 : bump.n })
  }

  // The bar's height as --calc-bar-h on <html>, for the room App leaves
  // under the page (it grows when the label wraps, or with the safe area).
  const barRef = useRef(null)
  useEffect(() => {
    const bar = barRef.current
    if (!visible || !bar || typeof ResizeObserver === 'undefined') return undefined
    const root = document.documentElement
    const observer = new ResizeObserver(() => root.style.setProperty('--calc-bar-h', `${bar.offsetHeight}px`))
    observer.observe(bar)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--calc-bar-h')
    }
  }, [visible])

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {visible && (
        <div
          ref={barRef}
          className="fixed inset-x-0 bottom-0 z-40 animate-rise px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-xl border border-line bg-surface/95 px-4 py-2.5 shadow-lg backdrop-blur">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-fg-muted">
                {undoInfo ? (
                  <>
                    <span className="truncate">{undoInfo.label}</span>
                    <Button variant="link" size="inline" onClick={calc.undo} className="shrink-0">
                      Undo
                    </Button>
                  </>
                ) : message?.kind === 'full' ? (
                  <span className="truncate font-semibold text-warning">{message.text}</span>
                ) : (
                  <span className="truncate">
                    {plural(totals.cards, 'card', 'cards')} · {plural(totals.copies, 'copy', 'copies')}
                    {totals.issues > 0 && (
                      <span className="text-warning">
                        {' '}
                        · ⚠ {plural(totals.issues, 'issue', 'issues')}
                      </span>
                    )}
                  </span>
                )}
              </div>
              {hasItems && (
                <div className="flex items-baseline gap-2 truncate">
                  <span key={bump.n} className={`text-lg font-bold tabular-nums text-accent ${bump.n ? 'animate-bump' : ''}`}>
                    {total.main}
                  </span>
                  {total.jpy && <span className="text-xs text-fg-muted">{total.jpy}</span>}
                </div>
              )}
            </div>
            <Button
              ref={buttonRef}
              variant="primary"
              onClick={onOpenPanel}
              aria-expanded={panelOpen}
              aria-controls="calc-panel"
              className="shrink-0"
            >
              View list
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

const WARNINGS = {
  oos: ['Out of stock', 'text-negative'],
  noprice: ['No price — not counted', 'text-fg-muted'],
  unlisted: ['No longer listed — last known price', 'text-warning'],
}

function lineWarnings(line) {
  const out = []
  for (const flag of line.flags) {
    if (flag === 'over') out.push([`Only ${line.stock} in stock`, 'text-warning'])
    else out.push(WARNINGS[flag])
  }
  return out
}

function CalcRow({ line, currency, rates, calc, onOpenCard, onRemove }) {
  const name = nameOf(line)
  const warnings = lineWarnings(line)
  return (
    <li className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <button
        type="button"
        onClick={() => onOpenCard(line.card)}
        disabled={!line.card}
        aria-label={`Open ${name}`}
        className="h-14 w-10 shrink-0 overflow-hidden rounded bg-surface-2 enabled:hover:ring-2 enabled:hover:ring-accent"
      >
        {line.imageUrl && <img src={line.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mono text-xs text-fg-subtle">{line.setCode}</span>
          <RarityBadge rarity={line.rarity} />
        </div>
        <p className="line-clamp-1 text-sm font-medium text-fg">{name}</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="flex items-center gap-2">
            <span className="text-xs text-fg-muted">{formatPrice(line.price, currency, rates)}</span>
            <QtyStepper value={line.qty} onChange={(n) => calc.setQty(line.id, n)} label={name} />
          </span>
          <span className="ml-auto text-sm font-bold tabular-nums text-accent">
            {formatPrice(line.lineJpy, currency, rates)}
          </span>
        </div>
        {warnings.map(([text, cls]) => (
          <p key={text} className={`mt-0.5 text-xs font-semibold ${cls}`}>
            {text}
          </p>
        ))}
      </div>
      <IconButton
        icon="close"
        size="sm"
        label={`Remove ${name}`}
        onClick={onRemove}
        data-remove={line.id}
        className="hover:text-negative"
      />
    </li>
  )
}

/**
 * The full list as a bottom sheet (phones) / floating card (desktop).
 * `saved` is useSavedLists(), for "Save list"; `onOpenSavedLists(listId?)`
 * closes the panel onto the Saved lists view.
 */
export function CalculatorPanel({ calc, saved, currency, rates, onClose, onOpenCard, onOpenSavedLists, returnFocusRef }) {
  const { lines, totals, undoInfo } = calc
  const sheetRef = useRef(null)
  const saveButtonRef = useRef(null)
  const [copyState, setCopyState] = useState(null) // null | 'copied' | 'failed'
  // null, 'naming' while the name field is open, then { id, text, warn } once
  // saved (warn: it only lives in this tab, storage refused it).
  const [saveState, setSaveState] = useState(null)
  const copyTimer = useRef(null)
  const total = totalText(totals, currency, rates)
  // Escape, Tab and the scroll lock; a card modal opened over the panel
  // takes the first two while it's up.
  useModal(sheetRef, { onClose })

  // Declared after useModal so, on unmount, this runs last and wins:
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

  // Removing a row, clearing or undoing deletes the focused control; hand
  // focus to a neighbour, or the sheet when nothing is left.
  const removeButtonOf = (id) => () =>
    [...sheetRef.current.querySelectorAll('[data-remove]')].find((b) => b.dataset.remove === id)
  const removeRow = (id) => {
    const i = lines.findIndex((l) => l.id === id)
    const neighbour = lines[i + 1] || lines[i - 1]
    calc.remove(id)
    focusSoon(neighbour ? removeButtonOf(neighbour.id) : () => sheetRef.current)
  }
  const clearAll = () => {
    calc.clear()
    focusSoon(() => sheetRef.current.querySelector('[data-calc-undo]') || sheetRef.current)
  }
  const undoFromEmpty = () => {
    calc.undo()
    focusSoon(() => sheetRef.current.querySelector('[data-remove]') || sheetRef.current)
  }

  const closeSaveForm = () => {
    setSaveState(null)
    focusSoon(() => saveButtonRef.current)
  }
  const saveList = (name) => {
    const result = saved.save(name, lines)
    const text = saveResultText(result)
    if (!result.id) return text
    setSaveState({ id: result.id, text, warn: Boolean(result.error) })
    focusSoon(() => saveButtonRef.current)
    return null
  }

  const showBuyable = totals.issues > 0 && totals.buyableJpy !== totals.totalJpy

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className={`${BACKDROP} z-40`}
    >
      <div
        ref={sheetRef}
        id="calc-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calc-title"
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 flex max-h-[85vh] supports-[height:100dvh]:max-h-[85dvh] flex-col rounded-t-xl bg-surface shadow-xl outline-none sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[30rem] sm:rounded-xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line py-1 pl-4 pr-2">
          <h2 id="calc-title" className="text-base font-bold text-fg">
            Price list{' '}
            <span className="text-xs font-normal text-fg-muted">
              ({plural(totals.cards, 'card', 'cards')})
            </span>
          </h2>
          <span className="flex shrink-0 items-center gap-1">
            <Button variant="link" size="inline" onClick={() => onOpenSavedLists()}>
              Saved lists
            </Button>
            <IconButton icon="close" size="lg" label="Close" onClick={onClose} />
          </span>
        </div>

        {lines.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            <p>Your list is empty.</p>
            {undoInfo && (
              <Button variant="link" onClick={undoFromEmpty} data-calc-undo className="mt-2">
                Undo — {undoInfo.label}
              </Button>
            )}
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {lines.map((line) => (
              <CalcRow
                key={line.id}
                line={line}
                currency={currency}
                rates={rates}
                calc={calc}
                onOpenCard={onOpenCard}
                onRemove={() => removeRow(line.id)}
              />
            ))}
          </ul>
        )}

        {lines.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-fg">
                Total ({plural(totals.copies, 'copy', 'copies')})
              </span>
              <span className="flex items-baseline gap-2">
                <span className="text-lg font-bold tabular-nums text-accent">{total.main}</span>
                {total.jpy && <span className="text-xs text-fg-muted">{total.jpy}</span>}
              </span>
            </div>
            {showBuyable && (
              <div className="text-xs text-fg-muted">
                <span className="font-semibold">
                  Buyable now: {formatPrice(totals.buyableJpy, currency, rates)}
                </span>
                <span className="block text-xs text-fg-subtle">
                  Excludes out-of-stock and unlisted cards, and copies beyond stock.
                </span>
              </div>
            )}
            <p className="text-xs text-fg-subtle">
              Prices from yuyu-tei, shipping not included; conversions approximate.
            </p>
            {saveState === 'naming' ? (
              <SaveListForm
                label="Save this list as"
                submitLabel="Save"
                defaultName={defaultListName(saved.lists)}
                onSubmit={saveList}
                onCancel={closeSaveForm}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <Button variant="primary" onClick={copyList}>
                    {copyState === 'copied' ? 'Copied!' : copyState === 'failed' ? 'Copy failed' : 'Copy list'}
                  </Button>
                  <Button ref={saveButtonRef} onClick={() => setSaveState('naming')}>
                    Save list
                  </Button>
                </span>
                <Button variant="danger" onClick={clearAll}>
                  Clear all
                </Button>
              </div>
            )}
            {/* Mounted with the footer, so the confirmation is announced;
                the negative margin cancels the gap while it's empty. */}
            <p
              role="status"
              className={`text-xs ${saveState?.id ? '' : '-mt-2'} ${saveState?.warn ? 'font-semibold text-warning' : 'text-fg-muted'}`}
            >
              {saveState?.id && (
                <>
                  {saveState.text}{' '}
                  <Button variant="link" size="inline" onClick={() => onOpenSavedLists(saveState.id)}>
                    Open in Saved lists
                  </Button>
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default CalculatorBar
