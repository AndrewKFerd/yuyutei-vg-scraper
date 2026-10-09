import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import Icon from './icons'
import { IconButton } from './controls'
import { FIELD } from '../ui'
import { setLabel } from '../sets'

const MAX_SUGGESTIONS = 50

// Searchable combobox narrowing the grid to one set at a time. A plain
// <select> doesn't scale well to 300+ sets, so this is a text input +
// filtered suggestion list instead — type a product code ("D-BT08", "dbt08"),
// the set's name or its slug, then click a suggestion, or use the keyboard:
// ArrowUp/ArrowDown move through the list, Enter picks the highlighted one
// (or, with nothing highlighted, an exact code match or the only suggestion
// left), Escape backs out. Combines (AND) with the text search and rarity
// filter.
//
// `options` is the catalog's set list ([{ slug, code, name }], newest
// first -- see sets.js); `value` is the selected slug ('' = all sets).
function SetFilter({ options, value, onChange, className = '' }) {
  const bySlug = useMemo(() => new Map(options.map((set) => [set.slug, set])), [options])
  const labelOf = (slug) => (slug ? setLabel(bySlug.get(slug) || { slug }) : '')
  const [query, setQuery] = useState(() => labelOf(value))
  const [open, setOpen] = useState(false)
  // Index into `items` of the keyboard-highlighted row, or -1 for none.
  const [activeIndex, setActiveIndex] = useState(-1)
  const listboxId = useId()
  const listRef = useRef(null)

  // Keep the displayed text in sync with the selected value when it changes
  // from outside (a "clear filters" chip, a shared link) — but only while
  // the user isn't actively typing, so we don't stomp on their input.
  const selectedText = value ? setLabel(bySlug.get(value) || { slug: value }) : ''
  useEffect(() => {
    if (!open) setQuery(selectedText)
  }, [selectedText, open])

  // Lowercased "slug code code-without-hyphens name" per set, built once per catalog.
  const haystacks = useMemo(
    () =>
      new Map(
        options.map((set) => [
          set.slug,
          [set.slug, set.code, set.code?.replace(/-/g, ''), set.name].filter(Boolean).join(' ').toLowerCase(),
        ])
      ),
    [options]
  )

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Showing the selected set's own label as the query shouldn't hide every other set.
    if (!q || q === selectedText.toLowerCase()) return options.slice(0, MAX_SUGGESTIONS)
    return options.filter((set) => haystacks.get(set.slug).includes(q)).slice(0, MAX_SUGGESTIONS)
  }, [options, haystacks, query, selectedText])

  // Every pickable row, "All sets" (null = clear) first.
  const items = useMemo(() => [null, ...suggestions], [suggestions])

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open || activeIndex < 0) return
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const select = (slug) => {
    onChange(slug)
    setQuery(labelOf(slug))
    setOpen(false)
    setActiveIndex(-1)
  }

  const close = () => {
    // Revert to the actual selection if the user leaves without picking a
    // suggestion, rather than leaving stray typed text.
    setOpen(false)
    setActiveIndex(-1)
    setQuery(selectedText)
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
        select(items[activeIndex]?.slug || '')
        return
      }
      const q = query.trim().toLowerCase()
      if (!q) {
        e.preventDefault()
        select('')
        return
      }
      const exact = options.find(
        (set) => set.slug === q || set.code?.toLowerCase() === q || set.code?.replace(/-/g, '').toLowerCase() === q
      )
      const pick = exact ?? (suggestions.length === 1 ? suggestions[0] : null)
      if (pick) {
        e.preventDefault()
        select(pick.slug)
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
    <div className={`relative ${className}`}>
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
        onFocus={(e) => {
          setOpen(true)
          e.target.select()
        }}
        onBlur={close}
        onKeyDown={handleKeyDown}
        placeholder="All sets"
        aria-label="Filter by set: type a set code or name"
        className={`${FIELD} w-full truncate pl-4 pr-10`}
      />
      {value && !open ? (
        <IconButton
          icon="close"
          label="Clear set filter"
          size="sm"
          onMouseDown={(e) => {
            e.preventDefault()
            select('')
          }}
          // Keyboard activation (Enter/Space fire click, not mousedown).
          onClick={() => select('')}
          className="absolute right-1 top-1/2 -translate-y-1/2"
        />
      ) : (
        <Icon
          name="chevronDown"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
        />
      )}
      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Sets"
          className="absolute z-30 mt-1 max-h-72 w-full min-w-64 overflow-y-auto rounded-lg border border-line bg-surface py-1 text-sm shadow-lg"
        >
          {items.map((set, index) => {
            const slug = set?.slug || ''
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
                className={`flex cursor-pointer items-baseline gap-2 px-3 py-2 ${active ? 'bg-surface-2' : ''} ${
                  selected ? 'text-accent' : 'text-fg'
                }`}
              >
                {set ? (
                  <>
                    {set.code && <span className="shrink-0 font-mono text-xs font-semibold">{set.code}</span>}
                    <span className={`truncate ${set.code ? 'text-fg-muted' : ''}`} lang={set.code ? 'ja' : undefined}>
                      {set.name || (set.code ? '' : set.slug)}
                    </span>
                  </>
                ) : (
                  <span className="text-fg-muted">All sets</span>
                )}
                {selected && <Icon name="check" className="ml-auto h-4 w-4 self-center" />}
              </li>
            )
          })}
          {suggestions.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-fg-subtle">
              No matching sets
            </li>
          )}
          {suggestions.length === MAX_SUGGESTIONS && options.length > MAX_SUGGESTIONS && (
            <li role="presentation" className="px-3 py-1.5 text-xs text-fg-subtle">
              Keep typing to narrow further…
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

export default memo(SetFilter)
