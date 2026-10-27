import { useEffect, useMemo, useRef, useState } from 'react'
import ConfirmBar from './ConfirmBar'
import DeltaChip from '../../ui/DeltaChip'
import PdfMenu from './PdfMenu'
import RarityBadge from '../../ui/RarityBadge'
import SaveListForm from './SaveListForm'
import Icon from '../../ui/icons'
import { Button, IconButton } from '../../ui/controls'
import { formatPrice } from '../../lib/currency'
import { derivedDetailUrl, derivedImageUrl } from '../../lib/catalogFormat'
import { sheetToCsv } from './csv'
import { download } from '../../ui/download'
import { formatDate, isoToMinute, plural, timeAgo } from '../../lib/format'
import { itemName } from './savedListsData'
import { refreshResultText } from './useSavedLists'
import { focusSoon } from '../../ui/useDialogFocus'

// One saved list as a spreadsheet-style sheet (Sheet), and the sheet tabs
// that switch between lists (SheetTabs), for the Saved lists view.

const toMinute = (ms) => Math.floor(ms / 60000)
const tabId = (listId) => `sheet-tab-${listId}`
const SINCE_SAVED = 'the time since these prices were saved'
// How long "Already matches today's…" stays under the header.
const NOTICE_MS = 5000

// Lettered A, B, C... above the headers, like a spreadsheet. The row-number
// gutter and the remove-button column get no letter. Only the qty and
// subtotal columns are totalled: a total under a unit-price column wouldn't
// be that column's sum.
const COLUMNS = [
  { key: 'card', label: 'Card' },
  { key: 'number', label: 'Number' },
  { key: 'rarity', label: 'Rarity' },
  { key: 'qty', label: 'Qty', right: true },
  { key: 'price', label: 'Unit price', right: true, title: 'Price when the list was saved or last refreshed' },
  { key: 'subtotal', label: 'Subtotal', right: true, title: 'Qty × unit price' },
  { key: 'now', label: 'Price now', right: true, title: 'yuyu-tei’s price in the loaded catalog' },
  { key: 'nowSubtotal', label: 'Subtotal now', right: true, title: 'Qty × price now' },
]

// Hairlines on each cell's right and bottom edge (the sheet's own border
// closes the outside). Sticky cells need an opaque fill, and stack: body
// row numbers and names (10) < headers and totals (20) < the corners where
// they meet (30). The row numbers are exactly w-10 wide, so the Card column
// sticks at left-10, right beside them.
const EDGES = 'border-b border-r border-line last:border-r-0'
const CELL = `${EDGES} whitespace-nowrap px-3 py-1.5`
const LETTER = `${EDGES} sticky top-0 h-6 bg-surface-2 px-3 text-center text-[11px] font-normal text-fg-muted`
const HEAD = `${CELL} sticky top-6 bg-surface-2 text-xs font-semibold text-fg-muted`
const GUTTER = `${EDGES} sticky left-0 w-10 min-w-10 bg-surface-2 px-2 text-center text-xs tabular-nums text-fg-muted`
const FOOT = 'sticky bottom-0 whitespace-nowrap border-r border-t border-line-strong bg-surface-2 px-3 py-2 font-semibold text-fg last:border-r-0'
// The card name, capped on phones so the stuck column leaves room to scroll.
const NAME_WIDTH = 'max-w-[8.5rem] sm:max-w-[16rem]'

// Each total is the sum of the column above it, so it matches a SUM over
// the exported CSV; a card with no current price (unlisted, or listed
// without one) is simply absent from "Subtotal now". The change compares
// like with like: only cards priced both when saved and now.
function sheetTotals(rows, pricesReady) {
  let copies = 0
  let savedJpy = 0
  let nowJpy = 0
  let changeFrom = 0
  let changeTo = 0
  for (const row of rows) {
    copies += row.qty
    if (row.subtotal != null) savedJpy += row.subtotal
    if (row.nowSubtotal != null) nowJpy += row.nowSubtotal
    if (row.subtotal != null && row.nowSubtotal != null) {
      changeFrom += row.subtotal
      changeTo += row.nowSubtotal
    }
  }
  return { copies, savedJpy, nowJpy: pricesReady ? nowJpy : null, changeFrom, changeTo }
}

// --- cells -------------------------------------------------------------------

// A quantity cell, edited in place: typing replaces the value (it's selected
// on focus), Enter or leaving the cell commits, Escape puts it back. Enter
// and ↑/↓ move to the row below/above, as in a spreadsheet.
function QtyCell({ value, label, row, onCommit, onMove }) {
  const [draft, setDraft] = useState(null)
  const commit = () => {
    if (draft === null) return
    setDraft(null)
    if (Number(draft) >= 1) onCommit(Number(draft))
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      data-qty-row={row}
      value={draft ?? String(value)}
      aria-label={`Quantity of ${label}`}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 2))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          setDraft(null)
        } else if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          // Moving focus blurs this cell, which commits it; at the last row
          // Enter just commits.
          if (!onMove(row + (e.key === 'ArrowUp' ? -1 : 1))) commit()
        }
      }}
      className="w-20 cursor-text bg-transparent px-3 py-1.5 text-right tabular-nums text-fg outline-none transition hover:bg-surface-2 focus:bg-surface focus:ring-2 focus:ring-inset focus:ring-accent"
    />
  )
}

// Stands in for a current price until the catalog is in ('loading'), or
// for good if it couldn't be loaded ('error').
function PricePending({ catalogStatus }) {
  return catalogStatus === 'error' ? (
    <span className="text-fg-subtle" title="Current prices unavailable">
      —
    </span>
  ) : (
    <span className="text-fg-subtle" title="Loading current prices…">
      …
    </span>
  )
}

function NowCell({ row, catalogStatus, currency, rates }) {
  if (catalogStatus !== 'ready') return <PricePending catalogStatus={catalogStatus} />
  if (!row.card) return <span className="text-xs font-semibold text-warning">Not listed</span>
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <DeltaChip from={row.price} to={row.now} period={SINCE_SAVED} />
      {formatPrice(row.now, currency, rates)}
    </span>
  )
}

// A total in the display currency, plus the JPY it came from when converted.
function Money({ jpy, currency, rates }) {
  const converted = currency !== 'JPY' && Boolean(rates)
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="text-accent">{formatPrice(jpy, currency, rates)}</span>
      {converted && jpy != null && (
        <span className="text-[11px] font-normal text-fg-muted">{formatPrice(jpy, 'JPY', null)}</span>
      )}
    </span>
  )
}

// The Watch all button's tooltip, for a sheet with `listed` cards in the
// catalog, `unwatched` of them not watched yet.
function watchAllTitle(listed, unwatched) {
  if (listed === 0) return 'None of these cards are listed now'
  if (unwatched === 0) return 'You’re watching every card in this list'
  return 'Watch these cards for restocks and price changes'
}

// --- sheet -------------------------------------------------------------------

function Sheet({
  list,
  saved,
  calc,
  cardsById,
  catalogStatus,
  currency,
  rates,
  catalogGeneratedAt,
  pdf,
  watchlist,
  onSelectCard,
  onDelete,
  announce,
}) {
  // null | 'rename' | 'delete' | 'load'
  const [mode, setMode] = useState(null)
  // Shown for a moment when a refresh found nothing to change (one that did
  // change something gets the Undo bar instead).
  const [notice, setNotice] = useState(null)
  const pdfNote = pdf.note?.listId === list.id ? pdf.note.text : null
  const gridRef = useRef(null)
  const panelRef = useRef(null)
  const renameRef = useRef(null)
  const deleteRef = useRef(null)
  const loadRef = useRef(null)
  const pdfRef = useRef(null)
  const refreshRef = useRef(null)
  const pdfBusy = pdf.job?.status === 'working'

  const rows = useMemo(
    () =>
      list.items.map((item) => {
        const card = cardsById.get(item.id) || null
        const now = card ? (card.price ?? null) : null
        return {
          ...item,
          card,
          now,
          subtotal: item.price == null ? null : item.price * item.qty,
          nowSubtotal: now == null ? null : now * item.qty,
        }
      }),
    [list.items, cardsById]
  )
  const pricesReady = catalogStatus === 'ready'
  const totals = useMemo(() => sheetTotals(rows, pricesReady), [rows, pricesReady])
  // The sheet's cards in order, for the card modal's previous/next.
  const catalogCards = useMemo(() => rows.map((row) => row.card).filter(Boolean), [rows])
  const empty = rows.length === 0
  const undoInfo = saved.undoInfo?.listId === list.id ? saved.undoInfo : null
  // The sheet's listed cards nobody's watching yet.
  const unwatched = catalogCards.filter((card) => !watchlist.watchedIds.has(card.id))

  const watchAll = () => {
    const added = watchlist.addCards(unwatched)
    announce(added ? `Watching ${plural(added, 'more card', 'more cards')}` : 'Already watching these cards')
  }

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const closeMode = (returnTo) => {
    setMode(null)
    focusSoon(() => returnTo.current)
  }

  const moveToRow = (index) => {
    const target = gridRef.current?.querySelector(`[data-qty-row="${index}"]`)
    target?.focus()
    return Boolean(target)
  }

  // Removing a row deletes the focused button; hand focus to a neighbour's,
  // or Undo / the sheet when nothing is left.
  const removeButtonOf = (id) => () =>
    [...gridRef.current.querySelectorAll('[data-remove-row]')].find((b) => b.dataset.removeRow === id)
  const removeRow = (index) => {
    const row = rows[index]
    const neighbour = rows[index + 1] || rows[index - 1]
    saved.removeItem(list.id, row.id)
    announce(`Removed ${itemName(row)}`)
    focusSoon(
      neighbour
        ? removeButtonOf(neighbour.id)
        : () => panelRef.current?.querySelector('[data-sheet-undo]') || panelRef.current
    )
  }

  // Undo of a removal puts the row back but unmounts its own button: focus
  // the restored row's remove button instead. Undo of a refresh goes back to
  // Refresh. The sheet, if either is somehow not there.
  const undoChange = () => {
    const { itemId } = undoInfo
    saved.undo()
    announce(itemId ? 'Restored' : 'Put back the names and prices from before')
    focusSoon(() => (itemId ? removeButtonOf(itemId)() : refreshRef.current) || panelRef.current)
  }

  // Brings the saved names and prices up to today's catalog, as if the list
  // were saved again now -- for when the wiki's English names land after a
  // list was saved, or to share it at today's prices.
  const refresh = () => {
    const result = saved.refresh(list.id, cardsById)
    if (!result) return
    const text = refreshResultText(result)
    setNotice(result.names || result.prices ? null : text)
    announce(text)
  }

  // Cards the catalog no longer has keep the saved snapshot; their image
  // and link follow from the id, as the catalog's own do.
  const load = () => {
    calc.replaceAll(
      list.items.map((item) => ({
        id: item.id,
        qty: item.qty,
        snap: { ...item, imageUrl: derivedImageUrl(item.id), detailUrl: derivedDetailUrl(item.id) },
      })),
      `Loaded “${list.name}”`
    )
    if (mode) closeMode(loadRef)
  }

  const exportCsv = () => {
    // The BOM tells Excel the file is UTF-8, so Japanese names survive.
    const blob = new Blob(['﻿', sheetToCsv(rows, totals)], { type: 'text/csv;charset=utf-8' })
    announce(`Downloaded ${download(list.name, 'csv', blob)}`)
  }

  // The PDF code (and its canvas work) loads only when asked for. The job,
  // its toast and its note live in App, so they carry on if another sheet
  // or view is opened meanwhile; `id` keeps a finished job's timer off the
  // next one.
  const exportPdf = async (prices) => {
    const id = Date.now()
    const update = (fn) => pdf.setJob((job) => (job?.id === id ? fn(job) : job))
    const setNote = (text) => pdf.setNote(text ? { listId: list.id, text } : null)
    pdf.setJob({ id, progress: 0, status: 'working', message: `Making a PDF of “${list.name}”…` })
    setNote(null)
    try {
      const { buildListPdf } = await import('./pdfExport')
      const { blob, missing } = await buildListPdf({
        list,
        rows,
        totals,
        prices,
        pricesAt: catalogGeneratedAt ? isoToMinute(catalogGeneratedAt) : null,
        currency,
        rates,
        pricesReady,
        onProgress: (progress) => update((job) => ({ ...job, progress })),
      })
      const filename = download(list.name, 'pdf', blob)
      const note = missing
        ? `${plural(missing, 'card image', 'card images')} couldn’t be loaded and ${missing === 1 ? 'is' : 'are'} left blank.`
        : null
      setNote(note)
      update((job) => ({ ...job, progress: 1, status: 'done', message: `Downloaded ${filename}${note ? `. ${note}` : ''}` }))
    } catch {
      const note = 'Couldn’t make the PDF. Check your connection and try again.'
      setNote(note)
      update((job) => ({ ...job, status: 'error', message: note }))
    }
  }

  // Totals row, by column key; columns not here stay blank.
  const footer = {
    qty: totals.copies.toLocaleString(),
    subtotal: <Money jpy={totals.savedJpy} currency={currency} rates={rates} />,
    nowSubtotal:
      totals.nowJpy === null ? (
        <span className="font-normal">
          <PricePending catalogStatus={catalogStatus} />
        </span>
      ) : (
        <span className="inline-flex items-center justify-end gap-1.5">
          <DeltaChip from={totals.changeFrom} to={totals.changeTo} period={SINCE_SAVED} />
          <Money jpy={totals.nowJpy} currency={currency} rates={rates} />
        </span>
      ),
  }

  const created = toMinute(list.createdAt)
  const priced = toMinute(list.pricedAt)
  const refreshed = list.pricedAt - list.createdAt > 60_000 ? priced : null
  const edited = list.updatedAt - Math.max(list.createdAt, list.pricedAt) > 60_000 ? toMinute(list.updatedAt) : null

  return (
    <div
      ref={panelRef}
      id="sheet-panel"
      role="tabpanel"
      aria-labelledby={tabId(list.id)}
      tabIndex={-1}
      className="outline-none"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-3 py-2.5 sm:px-4">
        {mode === 'rename' ? (
          <div className="min-w-0 flex-1 basis-72">
            <SaveListForm
              label="Rename list"
              submitLabel="Rename"
              defaultName={list.name}
              onSubmit={(name) => {
                saved.rename(list.id, name)
                closeMode(renameRef)
                return null
              }}
              onCancel={() => closeMode(renameRef)}
            />
          </div>
        ) : (
          <div className="min-w-0 flex-1 basis-48">
            <h3 className="truncate text-base font-bold text-fg" title={list.name}>
              {list.name}
            </h3>
            <p className="text-xs text-fg-muted">
              {plural(rows.length, 'card', 'cards')} · {plural(totals.copies, 'copy', 'copies')} · saved{' '}
              {formatDate(created, { year: true })}
              {refreshed !== null && ` · refreshed ${timeAgo(refreshed)}`}
              {edited !== null && ` · edited ${timeAgo(edited)}`}
            </p>
          </div>
        )}
        {/* Groups, so a narrow screen wraps between them, not mid-group. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1.5">
            <Button
              ref={loadRef}
              size="sm"
              onClick={() => (calc.items.length > 0 ? setMode('load') : load())}
              disabled={empty}
            >
              Load into price list
            </Button>
            <Button
              ref={refreshRef}
              size="sm"
              onClick={refresh}
              disabled={empty || !pricesReady}
              title={
                pricesReady
                  ? 'Update the names and prices to today’s, as if saving the list again'
                  : catalogStatus === 'error'
                    ? 'Today’s catalog couldn’t be loaded'
                    : 'Loading today’s catalog…'
              }
            >
              <Icon name="refresh" className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </span>
          <Button
            size="sm"
            onClick={watchAll}
            disabled={unwatched.length === 0}
            title={watchAllTitle(catalogCards.length, unwatched.length)}
          >
            <Icon name="eye" className="h-3.5 w-3.5" />
            {catalogCards.length > 0 && unwatched.length === 0 ? 'All watched' : 'Watch all'}
          </Button>
          <span className="flex items-center gap-1.5">
            <Button size="sm" onClick={exportCsv} disabled={empty}>
              Export CSV
            </Button>
            <PdfMenu
              buttonRef={pdfRef}
              disabled={empty}
              busy={pdfBusy}
              pricedOn={priced}
              refreshed={refreshed !== null}
              catalogStatus={catalogStatus}
              onChoose={exportPdf}
            />
          </span>
          <span className="flex items-center gap-1.5">
            <Button ref={renameRef} size="sm" variant="ghost" onClick={() => setMode('rename')}>
              Rename
            </Button>
            <Button ref={deleteRef} size="sm" variant="danger" onClick={() => setMode('delete')}>
              Delete
            </Button>
          </span>
        </div>
      </div>

      {mode === 'delete' && (
        <ConfirmBar
          text={`Delete “${list.name}”? This can’t be undone.`}
          confirmLabel="Delete list"
          danger
          onConfirm={() => onDelete(list)}
          onCancel={() => closeMode(deleteRef)}
        />
      )}
      {mode === 'load' && (
        <ConfirmBar
          text={`Replace the ${plural(calc.items.length, 'card', 'cards')} in your price list with this list?`}
          confirmLabel="Replace"
          onConfirm={load}
          onCancel={() => closeMode(loadRef)}
        />
      )}
      {pdfNote && (
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs text-fg-muted sm:px-4">
          <Icon name="info" className="h-4 w-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">{pdfNote}</span>
          <IconButton icon="close" size="sm" label="Dismiss" onClick={() => pdf.setNote(null)} />
        </div>
      )}
      {notice && !undoInfo && (
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs text-fg-muted sm:px-4">
          <Icon name="check" className="h-4 w-4 shrink-0 text-positive" />
          <span className="min-w-0 flex-1">{notice}</span>
        </div>
      )}
      {undoInfo && (
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs text-fg-muted sm:px-4">
          {/* A removal's label is one card name, so it truncates; a refresh's
              is a sentence the count matters in, so it wraps. */}
          <span className={undoInfo.itemId ? 'truncate' : 'min-w-0'}>{undoInfo.label}</span>
          <Button variant="link" size="inline" data-sheet-undo onClick={undoChange}>
            Undo
          </Button>
        </div>
      )}

      <div ref={gridRef} className="max-h-[min(65vh,40rem)] overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">{list.name}</caption>
          <thead>
            <tr aria-hidden="true">
              <th className={`${LETTER} left-0 z-30 w-10 min-w-10`} />
              {COLUMNS.map((col, i) => (
                <th key={col.key} className={`${LETTER} ${col.key === 'card' ? 'left-10 z-30' : 'z-20'}`}>
                  {String.fromCharCode(65 + i)}
                </th>
              ))}
              <th className={`${LETTER} z-20`} />
            </tr>
            <tr>
              <th scope="col" className={`${GUTTER} top-6 z-30 py-1.5 font-normal`}>
                <span className="sr-only">Row</span>
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  title={col.title}
                  className={`${HEAD} ${col.right ? 'text-right' : 'text-left'} ${
                    // Card soaks up any spare width, rather than the table
                    // spreading it evenly.
                    col.key === 'card' ? 'left-10 z-30 w-full' : 'z-20'
                  }`}
                >
                  {col.label}
                </th>
              ))}
              <th scope="col" className={`${HEAD} z-20`}>
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const name = itemName(row)
              return (
                // The row's number lights up while one of its cells has
                // focus, like a spreadsheet's active row header.
                <tr key={row.id} className="group">
                  <td className={`${GUTTER} z-10 group-focus-within:bg-accent-soft group-focus-within:font-semibold group-focus-within:text-accent`}>
                    {i + 1}
                  </td>
                  <th scope="row" className={`${CELL} sticky left-10 z-10 bg-surface text-left font-normal`}>
                    {row.card ? (
                      <button
                        type="button"
                        onClick={() => onSelectCard(row.card, catalogCards)}
                        title={name}
                        className={`block ${NAME_WIDTH} truncate text-left font-medium text-fg underline-offset-2 hover:text-accent hover:underline`}
                      >
                        {name}
                      </button>
                    ) : (
                      <span className={`block ${NAME_WIDTH} truncate font-medium text-fg`} title={name}>
                        {name}
                      </span>
                    )}
                  </th>
                  <td className={`${CELL} font-mono text-xs text-fg-muted`}>{row.setCode || '—'}</td>
                  <td className={CELL}>{row.rarity ? <RarityBadge rarity={row.rarity} /> : '—'}</td>
                  <td className={`${EDGES} p-0`}>
                    <QtyCell
                      value={row.qty}
                      label={name}
                      row={i}
                      onCommit={(qty) => saved.setQty(list.id, row.id, qty)}
                      onMove={moveToRow}
                    />
                  </td>
                  <td className={`${CELL} text-right tabular-nums text-fg`}>{formatPrice(row.price, currency, rates)}</td>
                  <td className={`${CELL} text-right font-semibold tabular-nums text-fg`}>
                    {formatPrice(row.subtotal, currency, rates)}
                  </td>
                  <td className={`${CELL} text-right tabular-nums text-fg`}>
                    <NowCell row={row} catalogStatus={catalogStatus} currency={currency} rates={rates} />
                  </td>
                  <td className={`${CELL} text-right font-semibold tabular-nums text-fg`}>
                    {pricesReady ? (
                      formatPrice(row.nowSubtotal, currency, rates)
                    ) : (
                      <PricePending catalogStatus={catalogStatus} />
                    )}
                  </td>
                  <td className={`${EDGES} px-1 text-center`}>
                    <IconButton
                      icon="close"
                      size="sm"
                      label={`Remove ${name}`}
                      data-remove-row={row.id}
                      onClick={() => removeRow(i)}
                      className="hover:text-negative"
                    />
                  </td>
                </tr>
              )
            })}
            {empty && (
              <tr>
                <td className={`${GUTTER} z-10`}>1</td>
                <td colSpan={COLUMNS.length + 1} className={`${CELL} py-6 text-center text-fg-muted`}>
                  This list is empty.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className={`${FOOT} left-0 z-30 w-10 min-w-10`} />
              <th scope="row" className={`${FOOT} left-10 z-30 text-left`}>
                Total
              </th>
              {COLUMNS.slice(1).map((col) => (
                <td key={col.key} className={`${FOOT} z-20 ${col.right ? 'text-right tabular-nums' : ''}`}>
                  {footer[col.key]}
                </td>
              ))}
              <td className={`${FOOT} z-20`} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// Spreadsheet-style tabs under the sheet. Arrow keys / Home / End move
// between them (and switch sheets); only the selected tab is in the Tab
// order, per the ARIA tabs pattern.
export function SheetTabs({ lists, activeId, onChange }) {
  const onKeyDown = (e, index) => {
    const last = lists.length - 1
    const next =
      e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null
    if (next === null) return
    e.preventDefault()
    onChange(lists[next].id)
    document.getElementById(tabId(lists[next].id))?.focus()
  }

  return (
    <div className="overflow-x-auto border-t border-line-strong bg-surface-2 px-2 pb-1.5">
      <div role="tablist" aria-label="Saved lists" className="flex gap-0.5">
        {lists.map((list, i) => {
          const selected = list.id === activeId
          return (
            <button
              key={list.id}
              id={tabId(list.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="sheet-panel"
              tabIndex={selected ? 0 : -1}
              title={list.name}
              onClick={() => onChange(list.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`-mt-px max-w-48 shrink-0 truncate rounded-b border px-3 py-1.5 text-xs font-semibold transition ${
                selected
                  ? 'border-line-strong border-t-surface bg-surface text-accent shadow-sm'
                  : 'border-transparent text-fg-muted hover:bg-surface hover:text-fg'
              }`}
            >
              {list.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default Sheet
