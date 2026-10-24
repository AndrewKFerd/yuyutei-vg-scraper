import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import DeltaChip from './DeltaChip'
import RarityBadge from './RarityBadge'
import SaveListForm from './SaveListForm'
import { ExportPanel, ImportPanel } from './ListTransfer'
import Icon from './icons'
import { EmptyMark } from './Logo'
import { Button, IconButton } from './controls'
import { formatPrice } from '../currency'
import { derivedDetailUrl, derivedImageUrl } from '../catalogFormat'
import { download } from '../download'
import { formatDate, isoToMinute, timeAgo } from '../history'
import { STORAGE_NOTES, defaultListName, itemName, refreshResultText, saveResultText } from '../useSavedLists'
import {
  MAX_TRANSFER_BYTES,
  TransferError,
  fillNames,
  importResultText,
  isTransferHash,
  needsNames,
  readBackupFile,
  readTransferHash,
} from '../listTransfer'
import { focusSoon } from '../useDialogFocus'
import { CONTAINER } from '../ui'

// Saved lists, one spreadsheet-style sheet per list (with sheet tabs to
// switch between them), next to the loaded catalog's current prices. No
// fetching of its own: "Price now" is whatever the catalog says.

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`
const toMinute = (ms) => Math.floor(ms / 60000)
const tabId = (listId) => `sheet-tab-${listId}`
const SINCE_SAVED = 'the time since these prices were saved'
// How long "Already matches today's…" stays under the header.
const NOTICE_MS = 5000
// How long an import's result stays under the view's heading.
const IMPORT_NOTICE_MS = 10000

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

// --- CSV ---------------------------------------------------------------------

const CSV_HEAD = [
  'Card',
  'Japanese name',
  'Number',
  'Rarity',
  'Qty',
  'Unit price (JPY)',
  'Subtotal (JPY)',
  'Price now (JPY)',
  'Subtotal now (JPY)',
  'Link',
]

function csvCell(value) {
  if (value == null) return ''
  if (typeof value === 'number') return String(value)
  // A leading = + - @ (or tab / CR, which some spreadsheets skip past) would
  // have the spreadsheet run the text as a formula.
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// Plain JPY numbers (not the display currency), so the columns add up in a
// spreadsheet and don't depend on an exchange rate.
function sheetToCsv(rows, totals) {
  const lines = [CSV_HEAD]
  for (const row of rows) {
    lines.push([
      row.nameEn || row.nameJp,
      row.nameJp,
      row.setCode,
      row.rarity,
      row.qty,
      row.price,
      row.subtotal,
      row.now,
      row.nowSubtotal,
      row.card ? row.card.detailUrl : derivedDetailUrl(row.id),
    ])
  }
  lines.push(['Total', null, null, null, totals.copies, null, totals.savedJpy, null, totals.nowJpy, null])
  return lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n')
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

// --- sheet -------------------------------------------------------------------

// Yes/no for a destructive step, in place of window.confirm. Focus starts on
// Cancel, so a stray Enter doesn't do the destructive thing.
function ConfirmBar({ text, confirmLabel, danger = false, onConfirm, onCancel }) {
  const cancelRef = useRef(null)
  useEffect(() => cancelRef.current?.focus({ preventScroll: true }), [])
  return (
    <div
      role="group"
      aria-label={text}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-highlight-line bg-highlight px-3 py-2 text-sm text-fg sm:px-4"
    >
      <p className="min-w-0 flex-1 basis-60">{text}</p>
      <span className="flex items-center gap-2">
        <Button size="sm" variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button ref={cancelRef} size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </span>
    </div>
  )
}

// --- PDF export --------------------------------------------------------------

// Export PDF's menu: which prices the PDF shows. Current ones lead, since a
// PDF is usually for passing on and saved ones would be read as today's;
// they need the catalog, so until it's in that item is there but disabled,
// saying why. The menu is `fixed`, placed from the button's box (and
// flipped above it when there's no room below), as the sheet clips its
// overflow.
function PdfMenu({ buttonRef, disabled, busy, pricedOn, refreshed, catalogStatus, onChoose }) {
  // null when closed, else which item takes focus on opening.
  const [openAt, setOpenAt] = useState(null)
  const menuRef = useRef(null)
  const id = useId()
  const open = openAt !== null
  const pricesReady = catalogStatus === 'ready'
  const options = [
    {
      key: 'now',
      label: 'Current prices',
      hint: pricesReady
        ? 'Today’s prices and total, best for sharing'
        : catalogStatus === 'error'
          ? 'Couldn’t load today’s prices; use Try again above'
          : 'Loading today’s prices…',
      disabled: !pricesReady,
    },
    {
      key: 'saved',
      label: 'Prices when saved',
      hint: `As ${refreshed ? 'refreshed' : 'saved'} on ${formatDate(pricedOn, { year: true })}${pricesReady ? ', with today’s change' : ''}`,
    },
    { key: 'none', label: 'No prices', hint: 'Just the cards and how many of each' },
  ]

  const close = (refocus) => {
    setOpenAt(null)
    if (refocus) focusSoon(() => buttonRef.current)
  }

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const box = buttonRef.current.getBoundingClientRect()
      const menu = menuRef.current
      const { width, height } = menu.getBoundingClientRect()
      const below = box.bottom + 4
      const above = box.top - 4 - height
      menu.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`
      menu.style.top = `${below + height > window.innerHeight - 8 && above > 8 ? above : below}px`
    }
    place()
    const items = menuRef.current.querySelectorAll('[role="menuitem"]')
    items[openAt === 'last' ? items.length - 1 : 0]?.focus({ preventScroll: true })
    // Clicking anywhere else closes it (the button toggles it itself), as
    // does scrolling the page: following the button, it would ride over the
    // sticky header.
    const outside = (e) => {
      if (!menuRef.current.contains(e.target) && !buttonRef.current.contains(e.target)) setOpenAt(null)
    }
    const scrolled = (e) => {
      if (!menuRef.current.contains(e.target)) setOpenAt(null)
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', scrolled, true)
    document.addEventListener('pointerdown', outside)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', scrolled, true)
      document.removeEventListener('pointerdown', outside)
    }
    // Placement and first focus happen once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Arrow keys move between items (wrapping), Home/End jump to the ends,
  // Escape closes back to the button and Tab closes and moves on.
  const onMenuKeyDown = (e) => {
    const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')]
    const at = items.indexOf(document.activeElement)
    const go = (i) => {
      e.preventDefault()
      items[(i + items.length) % items.length].focus()
    }
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
    else if (e.key === 'Escape') {
      e.preventDefault()
      close(true)
    } else if (e.key === 'Tab') close(false)
  }

  return (
    <>
      <Button
        ref={buttonRef}
        id={`${id}-button`}
        size="sm"
        disabled={disabled}
        aria-disabled={busy || undefined}
        aria-busy={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => {
          if (busy) return
          if (open) close(false)
          else setOpenAt('first')
        }}
        onKeyDown={(e) => {
          if (busy || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
          e.preventDefault()
          setOpenAt(e.key === 'ArrowUp' ? 'last' : 'first')
        }}
      >
        Export PDF
        <Icon name="chevronDown" className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>
      {open && (
        <div
          ref={menuRef}
          id={`${id}-menu`}
          role="menu"
          aria-labelledby={`${id}-button`}
          onKeyDown={onMenuKeyDown}
          className="fixed left-0 top-0 z-50 w-64 animate-dialog rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={option.disabled || undefined}
              aria-labelledby={`${id}-${option.key}-label`}
              aria-describedby={`${id}-${option.key}`}
              onClick={() => {
                if (option.disabled) return
                close(true)
                onChoose(option.key)
              }}
              className="flex w-full flex-col items-start rounded-md px-3 py-2 text-left transition hover:bg-surface-2 focus-visible:bg-surface-2 aria-disabled:cursor-not-allowed aria-disabled:hover:bg-transparent"
            >
              <span
                id={`${id}-${option.key}-label`}
                className={`text-sm font-semibold ${option.disabled ? 'text-fg-subtle' : 'text-fg'}`}
              >
                {option.label}
              </span>
              <span id={`${id}-${option.key}`} className="text-xs text-fg-muted">
                {option.hint}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

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
      const { buildListPdf } = await import('../pdfExport')
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
function SheetTabs({ lists, activeId, onChange }) {
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

/**
 * The Saved lists view. `saved` is useSavedLists(), `calc` useCalculator();
 * `activeId` (the open sheet) lives in App so saving from the price list
 * panel can open straight onto the new list.
 */
function SavedListsView({
  saved,
  calc,
  cardsById,
  catalogStatus,
  onRetryCatalog,
  catalogGeneratedAt,
  pdf,
  currency,
  rates,
  activeId,
  onActiveChange,
  onSelectCard,
}) {
  const { lists } = saved
  const [saving, setSaving] = useState(false)
  // `n` counts announcements so a repeat of the same text (a second
  // "Downloaded X.csv") still changes the region, and is read again.
  const [announcement, setAnnouncement] = useState({ text: '', n: 0 })
  const announce = (text) => setAnnouncement((prev) => ({ text, n: prev.n + 1 }))
  const [exporting, setExporting] = useState(false)
  // A link or file being imported (see ImportPanel), null otherwise.
  const [pending, setPending] = useState(null)
  // What the last import did, shown for a while under the heading.
  const [importNotice, setImportNotice] = useState(null)
  const saveButtonRef = useRef(null)
  const exportButtonRef = useRef(null)
  const importButtonRef = useRef(null)
  const fileRef = useRef(null)
  const headingRef = useRef(null)
  // Falls back to the newest list (e.g. the open one was deleted in another tab).
  const active = lists.find((list) => list.id === activeId) || lists[lists.length - 1] || null
  const calcEmpty = calc.items.length === 0

  const closeSave = () => {
    setSaving(false)
    focusSoon(() => saveButtonRef.current)
  }

  const closeExport = () => {
    setExporting(false)
    focusSoon(() => exportButtonRef.current || headingRef.current)
  }

  // A transfer link opened here (#import=...), on load or pasted into this
  // tab's address bar. The fragment stays until the import is confirmed or
  // closed, so a reload offers it again.
  useEffect(() => {
    let live = true
    let current = null
    const read = () => {
      const { hash } = window.location
      if (!isTransferHash(hash) || hash === current) return
      current = hash
      setPending({ source: 'link', status: 'reading' })
      readTransferHash(hash).then(
        ({ lists: incoming }) => {
          if (live && current === hash) setPending({ source: 'link', status: 'ready', lists: incoming })
        },
        (err) => {
          if (live && current === hash) setPending({ source: 'link', status: 'error', error: err?.code })
        }
      )
    }
    read()
    window.addEventListener('hashchange', read)
    return () => {
      live = false
      window.removeEventListener('hashchange', read)
    }
  }, [])

  useEffect(() => {
    if (!importNotice) return
    const timer = setTimeout(() => setImportNotice(null), IMPORT_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [importNotice])

  const chooseFile = async (e) => {
    const file = e.target.files?.[0]
    // So choosing the same file again still fires a change.
    e.target.value = ''
    if (!file) return
    const base = { source: 'file', fileName: file.name }
    if (file.size > MAX_TRANSFER_BYTES) {
      setPending({ ...base, status: 'error', error: 'too-big' })
      return
    }
    setPending({ ...base, status: 'reading' })
    try {
      const { lists: incoming } = readBackupFile(await file.text())
      setPending({ ...base, status: 'ready', lists: incoming })
    } catch (err) {
      setPending({ ...base, status: 'error', error: err instanceof TransferError ? err.code : 'broken' })
    }
  }

  // Done with a link's fragment: drop it, so a reload doesn't offer the
  // import again.
  const endImport = () => {
    if (pending?.source === 'link' && isTransferHash(window.location.hash)) {
      const { pathname, search } = window.location
      window.history.replaceState(window.history.state, '', `${pathname}${search}`)
    }
    setPending(null)
  }

  const cancelImport = () => {
    const fromFile = pending?.source === 'file'
    endImport()
    focusSoon(() => (fromFile ? importButtonRef.current : null) || headingRef.current)
  }

  const confirmImport = () => {
    const incoming = needsNames(pending.lists) ? fillNames(pending.lists, cardsById) : pending.lists
    const { counts, firstId } = saved.importLists(incoming)
    const text = importResultText(counts)
    endImport()
    if (firstId) onActiveChange(firstId)
    setImportNotice(text)
    announce(text)
    focusSoon(() => (firstId ? document.getElementById(tabId(firstId)) : null) || headingRef.current)
  }

  const saveCurrent = (name) => {
    const result = saved.save(name, calc.lines)
    const text = saveResultText(result)
    if (!result.id) return text
    onActiveChange(result.id)
    announce(text)
    closeSave()
    return null
  }

  // Like a spreadsheet, deleting a sheet opens the one after it (or before,
  // for the last).
  const deleteList = (list) => {
    const index = lists.findIndex((l) => l.id === list.id)
    const neighbour = lists[index + 1] || lists[index - 1] || null
    saved.remove(list.id)
    onActiveChange(neighbour?.id ?? null)
    announce(`Deleted “${list.name}”`)
    focusSoon(() => (neighbour ? document.getElementById(tabId(neighbour.id)) : headingRef.current))
  }

  return (
    <div className={`${CONTAINER} pb-10 pt-5`}>
      <p className="sr-only" aria-live="polite">
        {announcement.text}
        {announcement.n % 2 === 1 && '\u00a0'}
      </p>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="saved-lists-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold text-fg outline-none">
            Saved lists
          </h2>
          <p className="text-sm text-fg-muted">
            Price lists you’ve put aside, next to today’s prices. Kept in this browser only: to see them on your phone or
            another computer, use Export lists.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!saving && (
            <Button ref={saveButtonRef} variant="primary" onClick={() => setSaving(true)} disabled={calcEmpty}>
              <Icon name="plus" className="h-4 w-4" />
              Save price list
            </Button>
          )}
          {lists.length > 0 && (
            <Button
              ref={exportButtonRef}
              aria-expanded={exporting}
              onClick={() => (exporting ? closeExport() : setExporting(true))}
            >
              <Icon name="upload" className="h-4 w-4" />
              Export lists
            </Button>
          )}
          <Button ref={importButtonRef} onClick={() => fileRef.current?.click()}>
            <Icon name="download" className="h-4 w-4" />
            Import lists
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            tabIndex={-1}
            aria-hidden="true"
            onChange={chooseFile}
          />
        </div>
      </div>

      {pending && (
        <ImportPanel
          pending={pending}
          local={lists}
          catalogStatus={catalogStatus}
          onRetryCatalog={onRetryCatalog}
          onConfirm={confirmImport}
          onCancel={cancelImport}
        />
      )}

      {importNotice && (
        <p className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-fg-muted">
          <Icon name="check" className="h-4 w-4 shrink-0 text-positive" />
          <span className="min-w-0 flex-1">{importNotice}</span>
          <IconButton icon="close" size="sm" label="Dismiss" onClick={() => setImportNotice(null)} />
        </p>
      )}

      {exporting && lists.length > 0 && (
        <ExportPanel
          lists={lists}
          active={active}
          cardsById={cardsById}
          catalogStatus={catalogStatus}
          announce={announce}
          onClose={closeExport}
        />
      )}

      {saving && (
        <div className="mt-3 max-w-xl rounded-lg border border-line bg-surface p-3 shadow-sm">
          <SaveListForm
            label={`Save your price list (${plural(calc.items.length, 'card', 'cards')}) as`}
            submitLabel="Save"
            defaultName={defaultListName(lists)}
            disabled={calcEmpty}
            onSubmit={saveCurrent}
            onCancel={closeSave}
          />
        </div>
      )}

      {catalogStatus === 'error' && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-highlight-line bg-highlight px-3 py-2 text-xs text-fg"
        >
          <Icon name="info" className="mt-px h-4 w-4 text-warning" />
          <span>
            Couldn’t load the card catalog, so current prices aren’t shown — your saved lists are fine.{' '}
            <Button variant="link" size="inline" onClick={onRetryCatalog}>
              Try again
            </Button>
          </span>
        </p>
      )}

      {saved.storageError && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-highlight-line bg-highlight px-3 py-2 text-xs text-fg"
        >
          <Icon name="info" className="mt-px h-4 w-4 text-warning" />
          <span>{STORAGE_NOTES[saved.storageError]}</span>
        </p>
      )}

      {active ? (
        <>
          <section
            aria-labelledby="saved-lists-title"
            className="mt-5 overflow-hidden rounded-lg border border-line bg-surface shadow-sm"
          >
            <Sheet
              // Keyed so a half-done rename or confirmation doesn't carry
              // over to another list.
              key={active.id}
              list={active}
              saved={saved}
              calc={calc}
              cardsById={cardsById}
              catalogStatus={catalogStatus}
              currency={currency}
              rates={rates}
              catalogGeneratedAt={catalogGeneratedAt}
              pdf={pdf}
              onSelectCard={onSelectCard}
              onDelete={deleteList}
              announce={announce}
            />
            <SheetTabs lists={lists} activeId={active.id} onChange={onActiveChange} />
          </section>
          <p className="mt-2 text-xs text-fg-subtle">
            Unit price and subtotal are from when the list was saved (or last refreshed); price now and subtotal now are yuyu-tei’s
            current prices. Cards with no current price (no longer listed) are left out of subtotal now, and its
            change compares only cards priced both then and now. Refresh updates the names and prices to
            today’s. Click a quantity to change it. Conversions approximate.
          </p>
        </>
      ) : (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
          <EmptyMark icon="table" />
          <p className="text-base font-semibold text-fg">No saved lists yet</p>
          <p className="text-sm text-fg-muted">
            {calcEmpty
              ? 'Add cards to your price list with +, then save it here or from the list panel to keep a copy.'
              : 'Save your price list to keep a copy you can check against later prices or load back.'}
          </p>
          <p className="text-sm text-fg-muted">
            Saved lists on another device? Open Saved lists there and use Export lists to bring them here, or import a
            backup file.
          </p>
        </div>
      )}
    </div>
  )
}

export default SavedListsView
