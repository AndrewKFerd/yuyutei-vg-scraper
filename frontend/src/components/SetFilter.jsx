import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'

const MAX_SUGGESTIONS = 50

// Searchable combobox narrowing the grid to one set at a time. A plain
// <select> doesn't scale well to 300+ sets (scrolling raw slugs like
// "dzbt16" one by one), so this is a text input + filtered suggestion list
// instead — type to narrow, then click a suggestion, or use the keyboard:
// ArrowUp/ArrowDown move through the list, Enter picks the highlighted one
// (or, with nothing highlighted, an exact match or the only suggestion
// left), Escape backs out. Combines (AND) with the text search and rarity
// filter, same as before.
function SetFilter({ options, value, onChange }) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  // Index into `items` of the keyboard-highlighted row, or -1 for none.
  const [activeIndex, setActiveIndex] = useState(-1)
  const listboxId = useId()
  const listRef = useRef(null)

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

  // Every pickable row, "All Sets" ('' = clear) first.
  const items = useMemo(() => ['', ...suggestions], [suggestions])

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open || activeIndex < 0) return
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const select = (slug) => {
    onChange(slug)
    setQuery(slug)
    setOpen(false)
    setActiveIndex(-1)
  }

  const close = () => {
    // Revert to the actual selection if the user leaves without picking a
    // suggestion, rather than leaving stray typed text.
    setOpen(false)
    setActiveIndex(-1)
    setQuery(value)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((i) => {
        if (i < 0) return step === 1 ? 0 : items.length - 1
        return (i + step + items.length) % items.length
      })
    } else if (e.key === 'Enter') {
      if (open && activeIndex >= 0 && activeIndex < items.length) {
        e.preventDefault()
        select(items[activeIndex])
        return
      }
      const q = query.trim().toLowerCase()
      if (!q) {
        e.preventDefault()
        select('')
        return
      }
      const exact = options.find((slug) => slug.toLowerCase() === q)
      const pick = exact ?? (suggestions.length === 1 ? suggestions[0] : null)
      if (pick) {
        e.preventDefault()
        select(pick)
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        close()
      } else {
        e.currentTarget.blur()
      }
    }
  }

  const optionId = (index) => `${listboxId}-option-${index}`

  return (
    <div className="relative w-full sm:w-56">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setActiveIndex(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onKeyDown={handleKeyDown}
        placeholder="All Sets"
        aria-label="Search and filter by set"
        className="w-full rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-100 dark:border-night-600 dark:bg-night-800 dark:text-gold-500 dark:placeholder:text-gold-500/40 dark:focus:border-brand-500 dark:focus:ring-brand-500/20"
      />
      {value && !open && (
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            select('')
          }}
          // Keyboard activation (Enter/Space fire click, not mousedown).
          onClick={() => select('')}
          aria-label="Clear set filter"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-gold-500/60 dark:hover:text-gold-500"
        >
          ×
        </button>
      )}
      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Sets"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-night-600 dark:bg-night-800"
        >
          {items.map((slug, index) => {
            const active = index === activeIndex
            const selected = slug === value
            return (
              <li
                key={slug || '(all)'}
                id={optionId(index)}
                data-index={index}
                role="option"
                aria-selected={selected}
                onMouseDown={(e) => {
                  e.preventDefault()
                  select(slug)
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={`cursor-pointer px-3 py-1.5 ${slug ? 'font-mono' : ''} ${
                  active ? 'bg-brand-50 dark:bg-night-700' : ''
                } ${
                  selected
                    ? 'font-semibold text-brand-700 dark:text-brand-400'
                    : slug
                      ? 'text-slate-700 dark:text-gold-500'
                      : 'text-slate-500 dark:text-gold-500/70'
                }`}
              >
                {slug || 'All Sets'}
              </li>
            )
          })}
          {suggestions.length === 0 && (
            <li role="presentation" className="px-3 py-1.5 text-slate-400 dark:text-gold-500/50">
              No matching sets
            </li>
          )}
          {options.length > MAX_SUGGESTIONS && suggestions.length === MAX_SUGGESTIONS && (
            <li role="presentation" className="px-3 py-1 text-[11px] text-slate-400 dark:text-gold-500/50">
              Keep typing to narrow further…
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

export default memo(SetFilter)
