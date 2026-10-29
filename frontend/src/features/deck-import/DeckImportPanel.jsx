import { useEffect, useId, useMemo, useRef, useState } from 'react'
import SaveListForm from '../saved-lists/SaveListForm'
import RarityBadge from '../../ui/RarityBadge'
import Icon from '../../ui/icons'
import PanelHeading from '../../ui/PanelHeading'
import { Button, Segmented, Select } from '../../ui/controls'
import { formatPrice } from '../../lib/currency'
import { plural } from '../../lib/format'
import { stockInfo } from '../../lib/stock'
import Notice from '../../ui/Notice'
import { FIELD, PANEL } from '../../ui/classes'
import { focusSoon } from '../../ui/useDialogFocus'
import { readDeckInput } from './deckText'
import { buildDeckIndex, planDeck, shortCards } from './deckMatch'
import { DecklogError, decklogErrorText, fetchDecklog } from './decklog'
import { saveResultText } from '../saved-lists/useSavedLists'

// The deck importer: paste a Deck Log link or code, or a decklist, and
// get yuyu-tei's listings for it -- each card's copies from its listed
// printing, or from the cheapest printings in stock -- to add to the price
// list, save as a list, or watch the ones that are sold out. Matching is
// in deckMatch.js, reading the paste in deckText.js.

const PLACEHOLDER = `Deck Log link or code, e.g. https://decklog.bushiroad.com/view/A7G1
— or a decklist, one card per line:
4 D-BT01/001 Blaster Blade
4x ブラスター・ブレード
Blaster Blade x4`

const MODES = [
  ['cheapest', 'Cheapest in stock'],
  ['exact', 'Listed printings'],
]

const cardName = (card) => card.nameEn || card.nameJp || card.setCode || 'card'

function optionLabel(card) {
  const price = card.price === null ? 'no price' : formatPrice(card.price, 'JPY', null)
  return `${card.setCode || '?'} ${card.rarity || ''} · ${price} · ${stockInfo(card.stock).label.toLowerCase()}`
}

// One decklist line: what it asked for, the listings its copies come from,
// and a picker for a particular printing.
function DeckRow({ row, index, mode, choice, onChoose, currency, rates, onSelectCard }) {
  const { line, match, take, short } = row
  if (!match) {
    return (
      <li className="flex items-start gap-3 px-3 py-2.5 text-sm">
        <span className="w-8 shrink-0 text-right font-semibold tabular-nums text-fg-muted">{line.qty}×</span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-fg-muted">{line.raw}</p>
          <p className="text-xs font-semibold text-negative">No card with this number or name on yuyu-tei</p>
        </div>
      </li>
    )
  }
  const { listed, printings, via } = match
  const name = cardName(listed)
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5 text-sm">
      <span className="w-8 shrink-0 text-right font-semibold tabular-nums text-fg">{line.qty}×</span>
      <div className="min-w-0 flex-1 basis-52">
        <button
          type="button"
          onClick={() => onSelectCard(listed)}
          className="text-left font-medium leading-snug text-fg hover:text-accent"
        >
          {name}
        </button>
        <ul className="mt-1 flex flex-col gap-0.5 text-xs text-fg-muted">
          {take.map(({ card, qty }) => {
            const stock = stockInfo(card.stock)
            return (
              <li key={card.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="tabular-nums">{qty}×</span>
                <span className="font-mono">{card.setCode}</span>
                <RarityBadge rarity={card.rarity} />
                <span className="tabular-nums text-fg">{card.price === null ? 'no price' : formatPrice(card.price, currency, rates)}</span>
                <span className={stock.inStock ? 'text-positive' : 'text-negative'}>{stock.label}</span>
                {card.id !== listed.id && <span className="text-fg-subtle">· other printing</span>}
              </li>
            )
          })}
        </ul>
        {via === 'name' && <p className="mt-0.5 text-xs text-fg-subtle">Matched by name — check it’s the right card.</p>}
        {short > 0 && (
          <p className="mt-0.5 text-xs font-semibold text-warning">
            {plural(short, 'copy isn’t', 'copies aren’t')} in stock
          </p>
        )}
      </div>
      {printings.length > 1 && (
        <Select
          value={choice ?? ''}
          onChange={(value) => onChoose(index, value || null)}
          label={`Printing for ${name}`}
          className="w-full sm:w-64"
        >
          <option value="">{mode === 'cheapest' ? 'Cheapest in stock' : 'Listed printing'}</option>
          {printings.map((card) => (
            <option key={card.id} value={card.id}>
              {optionLabel(card)}
            </option>
          ))}
        </Select>
      )}
    </li>
  )
}

/**
 * Opened from the Saved lists view. `calc` is useCalculator(), `saved`
 * useSavedLists(), `watchlist` useWatchlist(). `onSaved(listId)` opens a
 * list it saved; `announce` speaks results to screen readers.
 */
function DeckImportPanel({
  cards,
  catalogStatus,
  onRetryCatalog,
  calc,
  saved,
  watchlist,
  currency,
  rates,
  onSelectCard,
  onSaved,
  onClose,
  announce,
}) {
  const [text, setText] = useState('')
  // null | { status: 'loading', code } | { status: 'error', message } |
  // { status: 'ready', title, lines, skipped }
  const [deck, setDeck] = useState(null)
  const [mode, setMode] = useState(/** @type {'cheapest' | 'exact'} */ ('cheapest'))
  // Line index -> listing id the user picked for it.
  const [choices, setChoices] = useState({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)
  const headingRef = useRef(null)
  const textRef = useRef(null)
  const requestRef = useRef(0)
  const textId = useId()
  const ready = catalogStatus === 'ready'

  useEffect(() => textRef.current?.focus({ preventScroll: true }), [])

  const index = useMemo(() => (ready ? buildDeckIndex(cards) : null), [ready, cards])
  const plan = useMemo(
    () => (deck?.status === 'ready' && index ? planDeck(deck.lines, index, mode, choices) : null),
    [deck, index, mode, choices]
  )
  const missing = useMemo(() => (plan ? shortCards(plan).filter((card) => !watchlist.watchedIds.has(card.id)) : []), [plan, watchlist.watchedIds])

  const show = (next) => {
    setDeck(next)
    setChoices({})
    setSaving(false)
    setNotice(null)
  }

  const read = async (e) => {
    e.preventDefault()
    const input = readDeckInput(text)
    const request = ++requestRef.current
    if (input.kind === 'empty') return show({ status: 'error', message: 'Paste a Deck Log link or code, or a decklist.' })
    if (input.kind === 'decklog-en') {
      return show({
        status: 'error',
        message:
          'English Deck Log links can’t be read here. Open the deck there, copy its card list, and paste that as text instead.',
      })
    }
    if (input.kind === 'text') {
      if (input.lines.length === 0) {
        return show({
          status: 'error',
          message: 'Couldn’t find any cards in that. Put one card per line with how many, like “4 D-BT01/001 Blaster Blade”.',
        })
      }
      return show({ status: 'ready', title: null, lines: input.lines, skipped: input.skipped })
    }
    show({ status: 'loading', code: input.code })
    try {
      const { title, lines } = await fetchDecklog(input.code)
      if (request !== requestRef.current) return
      if (lines.length === 0) return show({ status: 'error', message: `Deck ${input.code} on Deck Log has no cards.` })
      show({ status: 'ready', title: title || `Deck ${input.code}`, code: input.code, lines, skipped: [] })
    } catch (err) {
      if (request !== requestRef.current) return
      show({ status: 'error', message: decklogErrorText(err instanceof DecklogError ? err.code : 'upstream', input.code) })
    }
  }

  const choose = (lineIndex, id) => setChoices((prev) => ({ ...prev, [lineIndex]: id }))

  const addToPriceList = () => {
    const skipped = calc.addMany(plan.entries, `Added ${plural(plan.copies, 'copy', 'copies')} from ${deck.title || 'the decklist'}`)
    const text = skipped
      ? `Added to your price list, except ${plural(skipped, 'card', 'cards')}: the list is full.`
      : `Added ${plural(plan.entries.length, 'card', 'cards')} (${plural(plan.copies, 'copy', 'copies')}) to your price list.`
    setNotice(text)
    announce(text)
  }

  // Same messages as saving the price list: the limit keeps the form open;
  // a save that only lives in this tab says so.
  const saveAsList = (name) => {
    const result = saved.save(
      name,
      plan.entries.map(({ card, qty }) => ({ ...card, qty }))
    )
    const text = saveResultText(result)
    if (!result.id) return text
    announce(text)
    onSaved(result.id)
    return null
  }

  const watchMissing = () => {
    const added = watchlist.addCards(missing)
    const text = `Watching ${plural(added, 'card', 'cards')} for restocks — see Watchlist.`
    setNotice(text)
    announce(text)
  }

  const startOver = () => {
    requestRef.current++
    show(null)
    focusSoon(() => textRef.current)
  }

  return (
    <section
      aria-labelledby="deck-import-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) onClose()
      }}
      className={`${PANEL} border-line bg-surface`}
    >
      <PanelHeading
        id="deck-import-title"
        ref={headingRef}
        title={deck?.status === 'ready' && deck.title ? deck.title : 'Import a deck'}
        onClose={onClose}
      >
        Paste a Deck Log link or deck code, or a decklist, and see what it costs on yuyu-tei — then add it to your price
        list, save it as a list, or watch what’s sold out.
      </PanelHeading>

      {!ready && (
        <p className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
          {catalogStatus === 'error' ? (
            <>
              Couldn’t load the card catalog, which the import needs.
              <Button variant="link" size="inline" onClick={onRetryCatalog}>
                Try again
              </Button>
            </>
          ) : (
            'Loading the card catalog…'
          )}
        </p>
      )}

      {deck?.status !== 'ready' && (
        <form onSubmit={read} className="mt-3 flex flex-col gap-2">
          <label htmlFor={textId} className="sr-only">
            Deck Log link, deck code or decklist
          </label>
          <textarea
            ref={textRef}
            id={textId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            spellCheck={false}
            placeholder={PLACEHOLDER}
            className={`${FIELD} h-auto min-h-36 rounded-lg px-3 py-2 font-mono text-xs leading-relaxed`}
          />
          {deck?.status === 'error' && (
            <p role="alert" className="text-xs font-semibold text-negative">
              {deck.message}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" disabled={!ready || deck?.status === 'loading'}>
              <Icon name="search" className="h-4 w-4" />
              {deck?.status === 'loading' ? `Reading deck ${deck.code}…` : 'Find the cards'}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {plan && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-fg" aria-live="polite">
              <span className="font-semibold">{formatPrice(plan.totalJpy, currency, rates)}</span>
              {' for '}
              {plural(plan.copies, 'copy', 'copies')}
              {plan.matched < plan.rows.length && (
                <span className="text-negative"> · {plural(plan.rows.length - plan.matched, 'line', 'lines')} not found</span>
              )}
              {plan.short > 0 && <span className="text-warning"> · {plural(plan.short, 'copy', 'copies')} not in stock</span>}
              {plan.unpriced > 0 && <span className="text-fg-muted"> · {plural(plan.unpriced, 'copy', 'copies')} without a price</span>}
            </p>
            <Segmented label="Which printings" size="sm" options={MODES} value={mode} onChange={setMode} />
          </div>

          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {plan.rows.map((row, i) => (
              <DeckRow
                key={`${i}-${row.line.raw}`}
                row={row}
                index={i}
                mode={mode}
                choice={choices[i] ?? null}
                onChoose={choose}
                currency={currency}
                rates={rates}
                onSelectCard={onSelectCard}
              />
            ))}
          </ul>

          {deck.skipped?.length > 0 && (
            <details className="text-xs text-fg-muted">
              <summary className="cursor-pointer">
                {plural(deck.skipped.length, 'line was', 'lines were')} skipped (no count or card number)
              </summary>
              <ul className="mt-1 list-inside list-disc">
                {deck.skipped.map((line, i) => (
                  <li key={i} className="break-words">
                    {line}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {notice && (
            <Notice tone="success">{notice}</Notice>
          )}

          {saving ? (
            <SaveListForm
              label={`Save these ${plural(plan.entries.length, 'card', 'cards')} as`}
              submitLabel="Save"
              defaultName={deck.title || 'Imported deck'}
              onSubmit={saveAsList}
              onCancel={() => setSaving(false)}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={addToPriceList} disabled={plan.entries.length === 0}>
                <Icon name="plus" className="h-4 w-4" />
                Add to price list
              </Button>
              <Button onClick={() => setSaving(true)} disabled={plan.entries.length === 0}>
                <Icon name="table" className="h-4 w-4" />
                Save as a list
              </Button>
              {missing.length > 0 && (
                <Button onClick={watchMissing}>
                  <Icon name="bell" className="h-4 w-4" />
                  Watch {plural(missing.length, 'sold-out card', 'sold-out cards')}
                </Button>
              )}
              <Button variant="ghost" onClick={startOver} className="sm:ml-auto">
                Start over
              </Button>
            </div>
          )}
          <p className="text-xs text-fg-subtle">
            Cheapest in stock takes each card’s copies from its cheapest printings in stock (never more than 3× the listed
            printing’s price, or ¥300 more), and leaves any it can’t fill on the listed printing. Prices are from the loaded
            catalog.
          </p>
        </div>
      )}
    </section>
  )
}

export default DeckImportPanel
