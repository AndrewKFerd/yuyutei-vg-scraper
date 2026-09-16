import { memo, useEffect, useMemo, useState } from 'react'

const MAX_SUGGESTIONS = 50

// Searchable combobox narrowing the grid to one set at a time. A plain
// <select> doesn't scale well to 300+ sets (scrolling raw slugs like
// "dzbt16" one by one), so this is a text input + filtered suggestion list
// instead — type to narrow, click (or Enter on an exact match) to pick.
// Combines (AND) with the text search and rarity filter, same as before.
function SetFilter({ options, value, onChange }) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)

  // Keep the displayed text in sync with the selected value when it changes
  // from outside (e.g. a "clear filters" action elsewhere) — but only while
  // the user isn't actively typing, so we don't stomp on their input.
  useEffect(() => {
    if (!open) setQuery(value)
  }, [value, open])

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = q ? options.filter((slug) => slug.toLowerCase().includes(q)) : options
    return matches.slice(0, MAX_SUGGESTIONS)
  }, [options, query])

  const select = (slug) => {
    onChange(slug)
    setQuery(slug)
    setOpen(false)
  }

  const clear = () => {
    onChange('')
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="relative w-full sm:w-56">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Revert to the actual selection if the user leaves without
          // picking a suggestion, rather than leaving stray typed text.
          setOpen(false)
          setQuery(value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.currentTarget.blur()
        }}
        placeholder="All Sets"
        aria-label="Search and filter by set"
        className="w-full rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
      />
      {value && !open && (
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            clear()
          }}
          aria-label="Clear set filter"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        >
          ×
        </button>
      )}
      {open && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
          <li
            onMouseDown={(e) => {
              e.preventDefault()
              clear()
            }}
            className="cursor-pointer px-3 py-1.5 text-slate-500 hover:bg-brand-50"
          >
            All Sets
          </li>
          {suggestions.length === 0 && (
            <li className="px-3 py-1.5 text-slate-400">No matching sets</li>
          )}
          {suggestions.map((slug) => (
            <li
              key={slug}
              onMouseDown={(e) => {
                e.preventDefault()
                select(slug)
              }}
              className={`cursor-pointer px-3 py-1.5 font-mono hover:bg-brand-50 ${
                slug === value ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-700'
              }`}
            >
              {slug}
            </li>
          ))}
          {options.length > MAX_SUGGESTIONS && suggestions.length === MAX_SUGGESTIONS && (
            <li className="px-3 py-1 text-[11px] text-slate-400">
              Keep typing to narrow further…
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

export default memo(SetFilter)
