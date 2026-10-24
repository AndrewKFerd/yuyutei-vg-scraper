import { useEffect, useRef, useState } from 'react'
import SaveListForm from './SaveListForm'
import Sheet, { SheetTabs } from './Sheet'
import { ExportPanel, ImportPanel } from './TransferPanels'
import Icon from '../../ui/icons'
import { EmptyMark } from '../../ui/Logo'
import { Button, IconButton } from '../../ui/controls'
import { STORAGE_NOTES, defaultListName, saveResultText } from './useSavedLists'
import {
  MAX_TRANSFER_BYTES,
  TransferError,
  fillNames,
  importResultText,
  isTransferHash,
  needsNames,
  readBackupFile,
  readTransferHash,
} from './listTransfer'
import { focusSoon } from '../../ui/useDialogFocus'
import { CONTAINER } from '../../ui/classes'

// Saved lists, one spreadsheet-style sheet per list (with sheet tabs to
// switch between them; see Sheet.jsx), next to the loaded catalog's current
// prices, plus moving lists to and from other browsers (TransferPanels.jsx).
// No fetching of its own: "Price now" is whatever the catalog says.

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`
// How long an import's result stays under the view's heading.
const IMPORT_NOTICE_MS = 10000
// The open list's sheet tab, once a change of list has rendered.
const selectedTab = () => document.querySelector('[role="tab"][aria-selected="true"]')

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
    focusSoon(() => (firstId ? selectedTab() : null) || headingRef.current)
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
    focusSoon(() => (neighbour ? selectedTab() : null) || headingRef.current)
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
