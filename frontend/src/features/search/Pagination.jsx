import { useEffect, useState } from 'react'
import Icon from '../../ui/icons'
import { buttonClass } from '../../ui/classes'

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

// How far the floating pager must rise so it sits above the page footer
// (and its "unofficial fan tool" note) once that scrolls into view: the
// part of the footer showing above the price-list bar, if that's up.
function useFooterLift(active) {
  const [lift, setLift] = useState(0)
  useEffect(() => {
    if (!active) return undefined
    let frame = 0
    const measure = () => {
      frame = 0
      const footer = document.querySelector('footer')
      if (!footer) return
      const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--calc-bar-h')) || 0
      const showing = window.innerHeight - footer.getBoundingClientRect().top
      setLift(Math.max(0, Math.round(showing - bar)))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [active])
  return active ? lift : 0
}

function Pagination({ page, totalPages, onChange }) {
  const lift = useFooterLift(totalPages > 1)
  if (totalPages <= 1) return null

  const goTo = (next) => onChange(Math.min(Math.max(next, 1), totalPages))
  const step = `${buttonClass('secondary', 'sm')} h-9 min-w-9 px-2.5`

  // A floating pill at the bottom of the screen, so changing page never
  // means scrolling to the end of the grid. It rides above the price-list
  // bar when that's up (--calc-bar-h, set by CalculatorBar); the grid
  // leaves room for it (SearchView). At the very end of the page it rises
  // with the footer instead of covering it (useFooterLift).
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-3 transition-transform duration-100 ease-out"
      style={{
        bottom: 'calc(var(--calc-bar-h, 0px) + max(0.75rem, env(safe-area-inset-bottom)))',
        transform: lift ? `translateY(-${lift}px)` : undefined,
      }}
    >
      <nav
        aria-label="Pages"
        className="pointer-events-auto flex animate-rise items-center gap-1.5 rounded-full border border-line bg-surface/95 p-1.5 text-sm shadow-lg backdrop-blur supports-[backdrop-filter]:bg-surface/85"
      >
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
    </div>
  )
}

export default Pagination
