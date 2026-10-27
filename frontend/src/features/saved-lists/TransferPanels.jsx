import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../ui/icons'
import { Button, IconButton, Segmented } from '../../ui/controls'
import { download } from '../../ui/download'
import PanelHeading from '../../ui/PanelHeading'
import { plural } from '../../lib/format'
import { FIELD } from '../../ui/classes'
import { MAX_LISTS } from './savedListsData'
import { backupFileText, countPlan, needsNames, planImport, transferErrorText, transferLink } from './listTransfer'

// Moving saved lists to another device: the Export panel (a QR code and a
// link that open the lists there, and a backup file) and the Import panel
// (what a link or file holds, and what importing it would do, before
// anything changes). The formats live in listTransfer.js.

// The QR code stops at version 22 (105 modules a side): denser codes get hard
// to scan off a screen. That's about 1 KB of link: 45 catalog cards take
// under 500 characters.
const QR_MAX_VERSION = 22
const PANEL = 'mt-3 rounded-lg border p-3 shadow-sm sm:p-4'

// "2026-10-24" in the viewer's own time zone, for backup file names.
function localDate(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// One path for the dark modules, a run of them per subpath, so a big code
// stays one small element.
function qrPath(data) {
  let d = ''
  data.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue
      let end = x
      while (row[end + 1]) end++
      d += `M${x} ${y}h${end - x + 1}v1H${x}z`
      x = end
    }
  })
  return d
}

// Dark on white whatever the theme: scanners want the contrast, and a
// 4-module quiet zone around it.
function QrCode({ qr }) {
  const side = qr.size + 8
  return (
    <svg
      viewBox={`-4 -4 ${side} ${side}`}
      role="img"
      aria-label="QR code of the link"
      shapeRendering="crispEdges"
      style={{ width: Math.min(256, Math.max(176, side * 3)) }}
      className="block h-auto max-w-full rounded-md bg-white"
    >
      <path d={qrPath(qr.data)} fill="#000" />
    </svg>
  )
}

/**
 * The Export panel. `active` is the open sheet's list, offered on its own
 * when there are several. The link leaves out the names of cards in
 * `cardsById` (the receiving browser fills them in from the same catalog),
 * so it's only built from the catalog once that's in.
 */
export function ExportPanel({ lists, active, cardsById, catalogStatus, announce, onClose }) {
  const [scope, setScope] = useState('all')
  const one = scope === 'one' && active && lists.length > 1
  const chosen = useMemo(() => (one ? [active] : lists), [one, active, lists])
  // { url, qr } once built: qr is { size, data }, or null if the link is too
  // long for one. 'error' if the link couldn't be made.
  const [built, setBuilt] = useState(null)
  // null | 'copied' | 'failed' (then the link is shown to copy by hand)
  const [copy, setCopy] = useState(null)
  const headingRef = useRef(null)
  const linkFieldRef = useRef(null)
  const catalog = catalogStatus === 'ready' ? cardsById : null
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  useEffect(() => headingRef.current?.focus({ preventScroll: true }), [])

  useEffect(() => {
    let live = true
    setBuilt(null)
    setCopy(null)
    ;(async () => {
      try {
        const url = await transferLink(chosen, { origin: window.location.origin, cardsById: catalog })
        const { encode } = await import('uqr')
        let qr = null
        try {
          const { size, data } = encode(url, { ecc: 'L', border: 0, maxVersion: QR_MAX_VERSION })
          qr = { size, data }
        } catch {
          // Too long for a QR code; the link still works.
        }
        if (live) setBuilt({ url, qr })
      } catch {
        if (live) setBuilt('error')
      }
    })()
    return () => {
      live = false
    }
  }, [chosen, catalog])

  useEffect(() => {
    if (copy === 'failed') linkFieldRef.current?.select()
  }, [copy])

  const url = built && built !== 'error' ? built.url : null
  const what = one ? `“${active.name}”` : plural(chosen.length, 'saved list', 'saved lists')

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopy('copied')
      announce('Copied the link')
    } catch {
      setCopy('failed')
    }
  }

  const share = async () => {
    try {
      await navigator.share({ title: one ? active.name : 'Saved lists', url })
    } catch (err) {
      // AbortError: the share sheet was closed without sharing.
      if (err?.name !== 'AbortError') setCopy('failed')
    }
  }

  const downloadBackup = () => {
    const blob = new Blob([backupFileText(chosen)], { type: 'application/json' })
    const name = one ? active.name : `yytscrap saved lists ${localDate()}`
    announce(`Downloaded ${download(name, 'json', blob)}`)
  }

  return (
    <section
      aria-labelledby="export-lists-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      className={`${PANEL} border-line bg-surface`}
    >
      <PanelHeading id="export-lists-title" ref={headingRef} title="Open your saved lists on another device" onClose={onClose}>
        Saved lists stay in the browser they were made in. To see them on your phone or another computer, send them
        across with a link, or keep them in a backup file.
      </PanelHeading>

      {lists.length > 1 && active && (
        <Segmented
          label="Which lists"
          size="sm"
          className="mt-3"
          value={one ? 'one' : 'all'}
          onChange={setScope}
          options={[
            ['all', `All ${lists.length} lists`],
            ['one', 'Just this list'],
          ]}
        />
      )}

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex shrink-0 justify-center sm:block">
          {built === null ? (
            <div className="flex h-44 w-44 items-center justify-center rounded-md border border-dashed border-line text-xs text-fg-subtle">
              Making the code…
            </div>
          ) : built !== 'error' && built.qr ? (
            <QrCode qr={built.qr} />
          ) : (
            <div className="flex h-44 w-44 items-center justify-center rounded-md border border-dashed border-line p-3 text-center text-xs text-fg-muted">
              {built === 'error'
                ? 'Couldn’t make a link in this browser. Use a backup file instead.'
                : `Too many cards for a QR code. Copy or share the link instead${lists.length > 1 && !one ? ', or choose Just this list' : ''}.`}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 text-sm text-fg">
          {built !== 'error' && built?.qr && (
            <p>
              <span className="font-semibold">On a phone:</span> point its camera at the code, and open the link it
              shows.
            </p>
          )}
          <p className={built?.qr ? 'mt-2' : ''}>
            <span className="font-semibold">{built?.qr ? 'Or send' : 'Send'} yourself the link</span> (in a chat or an
            email to yourself) and open it on the other device.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={copyLink} disabled={!url}>
              <Icon name={copy === 'copied' ? 'check' : 'copy'} className="h-3.5 w-3.5" />
              {copy === 'copied' ? 'Copied' : 'Copy link'}
            </Button>
            {canShare && (
              <Button size="sm" onClick={share} disabled={!url}>
                <Icon name="share" className="h-3.5 w-3.5" />
                Share…
              </Button>
            )}
          </div>
          {copy === 'failed' && url && (
            <label className="mt-2 flex flex-col gap-1 text-xs text-fg-muted">
              Couldn’t copy it for you. Copy the link from here:
              <input
                ref={linkFieldRef}
                readOnly
                value={url}
                onFocus={(e) => e.target.select()}
                className={`${FIELD} px-4 font-mono text-xs`}
              />
            </label>
          )}
          <p className="mt-2 text-xs text-fg-muted">
            The link holds {one ? 'the list itself' : 'the lists themselves'} and nothing is uploaded, so anyone you send it
            to can open {one ? 'it' : 'them'}. On the other device, open it in the browser you use for this site rather
            than inside the chat app, or the {one ? 'list' : 'lists'} will be saved inside that app.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3">
        <Button size="sm" onClick={downloadBackup}>
          <Icon name="download" className="h-3.5 w-3.5" />
          Download backup file
        </Button>
        <p className="min-w-0 flex-1 basis-60 text-xs text-fg-muted">
          A file of {what}, to keep or move by hand. Open it on any device with Import lists.
        </p>
      </div>
    </section>
  )
}

const STATUS_TEXT = {
  new: 'New',
  update: 'Newer than yours, replaces it',
  same: 'Already here',
  kept: 'Yours is newer, kept',
  full: `No room (${MAX_LISTS} lists at most)`,
}

/**
 * The Import panel, for `pending`: { source: 'link' | 'file', fileName,
 * status: 'reading' | 'ready' | 'error', lists, error }. Shows what each
 * list would do against `local`; names left out of a link are filled from
 * the catalog, so importing one waits for it.
 */
export function ImportPanel({ pending, local, catalogStatus, onRetryCatalog, onConfirm, onCancel }) {
  const headingRef = useRef(null)
  const ready = pending.status === 'ready'
  const plan = useMemo(() => (ready ? planImport(local, pending.lists) : []), [ready, local, pending.lists])
  const counts = countPlan(plan)
  const changes = counts.new + counts.update
  const waiting = ready && changes > 0 && needsNames(pending.lists) && catalogStatus !== 'ready'
  const from = pending.source === 'link' ? 'a link' : pending.fileName ? `“${pending.fileName}”` : 'a file'

  useEffect(() => headingRef.current?.focus({ preventScroll: true }), [pending.status])

  return (
    <section
      aria-labelledby="import-lists-title"
      aria-busy={pending.status === 'reading'}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
      className={`${PANEL} border-highlight-line bg-highlight`}
    >
      <div className="flex items-start gap-3">
        <h3 id="import-lists-title" ref={headingRef} tabIndex={-1} className="min-w-0 flex-1 text-base font-bold text-fg outline-none">
          {pending.status === 'error'
            ? `Couldn’t import from ${from}`
            : ready
              ? `Import ${plural(pending.lists.length, 'saved list', 'saved lists')} from ${from}?`
              : `Reading ${from}…`}
        </h3>
        <IconButton icon="close" size="sm" label="Close" onClick={onCancel} />
      </div>

      {pending.status === 'error' && (
        <p role="alert" className="mt-1 text-sm text-fg">
          {transferErrorText(pending.error, pending.source)}
        </p>
      )}

      {ready && (
        <>
          <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line bg-surface">
            {plan.map(({ list, status }) => (
              <li key={list.id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-1.5 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-semibold text-fg">{list.name}</span>
                  <span className="text-xs text-fg-muted"> · {plural(list.items.length, 'card', 'cards')}</span>
                </span>
                <span
                  className={`text-xs font-semibold ${
                    status === 'new' || status === 'update' ? 'text-accent' : status === 'full' ? 'text-warning' : 'text-fg-muted'
                  }`}
                >
                  {STATUS_TEXT[status]}
                </span>
              </li>
            ))}
          </ul>
          {waiting && (
            <p className="mt-2 text-xs text-fg-muted">
              {catalogStatus === 'error' ? (
                <>
                  Couldn’t load the card catalog, which fills in the card names.{' '}
                  <Button variant="link" size="inline" onClick={onRetryCatalog}>
                    Try again
                  </Button>
                </>
              ) : (
                'Loading the card catalog, which fills in the card names…'
              )}
            </p>
          )}
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {ready && changes > 0 && (
          <Button variant="primary" size="sm" onClick={onConfirm} disabled={waiting}>
            Import {plural(changes, 'list', 'lists')}
          </Button>
        )}
        <Button variant={ready && changes > 0 ? 'ghost' : 'secondary'} size="sm" onClick={onCancel}>
          {ready && changes > 0 ? 'Cancel' : 'Close'}
        </Button>
        {ready && changes === 0 && <span className="text-xs text-fg-muted">Nothing new to import.</span>}
      </div>

      {pending.source === 'link' && ready && changes > 0 && (
        <p className="mt-3 text-xs text-fg-muted">
          Lists are saved in this browser. If this link opened inside a chat app, open it in your usual browser instead
          (from the app’s menu), so they’re where you’ll look for them.
        </p>
      )}
    </section>
  )
}
