import { useState } from 'react'
import Icon from './icons'
import { buttonClass } from '../ui'

// Client-side pagination controls. With a catalog running into the tens of
// thousands of rows, rendering every matching card's <img> at once would be
// slow and memory-heavy, so App.jsx slices the filtered results into pages
// and this component just drives which page is active.
//
// Wide screens get numbered pages (first, last and the two either side of
// the current one, with gaps elided); phones get Prev / "Page [n] of N" /
// Next, where the number is a field you can type a page into.

/** [1, '…', 4, 5, 6, 7, 8, '…', 560] around `page`. */
function pageWindow(page, total) {
  const pages = new Set([1, total])
  for (let p = page - 2; p <= page + 2; p++) if (p >= 1 && p <= total) pages.add(p)
  const sorted = [...pages].sort((a, b) => a - b)
  const out = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push(sorted[i] - sorted[i - 1] === 2 ? sorted[i] - 1 : '…')
    out.push(sorted[i])
  }
  return out
}

function PageField({ page, totalPages, onChange }) {
  // Raw text while typing; committed on Enter or blur.
  const [draft, setDraft] = useState(null)
  const commit = () => {
    if (draft === null) return
    const n = Number(draft)
    setDraft(null)
    if (Number.isInteger(n) && n >= 1 && n <= totalPages && n !== page) onChange(n)
  }
  return (
    <label className="flex items-center gap-1.5 text-xs text-fg-muted">
      Page
      <input
        type="text"
        inputMode="numeric"
        value={draft ?? String(page)}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 5))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
        aria-label={`Page number, 1 to ${totalPages}`}
        className="h-8 w-14 rounded-full border border-line-strong bg-surface text-center text-sm font-semibold tabular-nums text-fg outline-none focus:border-accent focus:ring-4 focus:ring-ring"
      />
      of {totalPages.toLocaleString()}
    </label>
  )
}

function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null

  const goTo = (next) => onChange(Math.min(Math.max(next, 1), totalPages))
  const step = `${buttonClass('secondary', 'sm')} h-9 min-w-9 px-2.5`

  return (
    <nav aria-label="Pages" className="flex items-center justify-center gap-1.5 pb-10 pt-2 text-sm">
      <button type="button" onClick={() => goTo(page - 1)} disabled={page <= 1} className={step}>
        <Icon name="chevronLeft" className="h-4 w-4" />
        <span className="sr-only sm:not-sr-only">Prev</span>
      </button>

      <div className="sm:hidden">
        <PageField page={page} totalPages={totalPages} onChange={goTo} />
      </div>

      <ol className="hidden items-center gap-1 sm:flex">
        {pageWindow(page, totalPages).map((p, i) =>
          p === '…' ? (
            <li key={`gap-${i}`} aria-hidden="true" className="px-1 text-fg-subtle">
              …
            </li>
          ) : (
            <li key={p}>
              <button
                type="button"
                onClick={() => goTo(p)}
                aria-current={p === page ? 'page' : undefined}
                aria-label={`Page ${p}`}
                className={`h-9 min-w-9 rounded-full px-2 text-sm font-semibold tabular-nums transition ${
                  p === page ? 'bg-accent-solid text-on-accent shadow-sm' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
                }`}
              >
                {p.toLocaleString()}
              </button>
            </li>
          )
        )}
      </ol>

      <button type="button" onClick={() => goTo(page + 1)} disabled={page >= totalPages} className={step}>
        <span className="sr-only sm:not-sr-only">Next</span>
        <Icon name="chevronRight" className="h-4 w-4" />
      </button>
    </nav>
  )
}

export default Pagination
