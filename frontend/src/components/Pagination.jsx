// Client-side pagination controls. With a catalog running into the tens of
// thousands of rows, rendering every matching card's <img> at once would be
// slow and memory-heavy, so App.jsx slices the filtered results into pages
// and this component just drives which page is active — no extra
// dependency needed for something this simple.
function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null

  const goTo = (nextPage) => {
    const clamped = Math.min(Math.max(nextPage, 1), totalPages)
    onChange(clamped)
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  return (
    <div className="flex items-center justify-center gap-3 pb-10 text-sm">
      <button
        type="button"
        onClick={() => goTo(page - 1)}
        disabled={page <= 1}
        className="rounded-full border border-slate-300 bg-white px-4 py-1.5 font-medium text-slate-700 shadow-sm transition hover:border-brand-400 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:text-slate-700"
      >
        Prev
      </button>
      <span className="text-xs text-slate-500">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        onClick={() => goTo(page + 1)}
        disabled={page >= totalPages}
        className="rounded-full border border-slate-300 bg-white px-4 py-1.5 font-medium text-slate-700 shadow-sm transition hover:border-brand-400 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:text-slate-700"
      >
        Next
      </button>
    </div>
  )
}

export default Pagination
