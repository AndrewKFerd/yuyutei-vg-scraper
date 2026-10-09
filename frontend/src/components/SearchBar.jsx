import { useRef } from 'react'
import Icon from './icons'
import { IconButton } from './controls'
import { FIELD } from '../ui'

// Autofocus only where it can't pop a soft keyboard over the page: phones
// and tablets (coarse pointers) start with the grid in view instead.
const FINE_POINTER = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches

function SearchBar({ value, onChange, className = '' }) {
  const inputRef = useRef(null)
  return (
    <div role="search" className={`relative ${className}`}>
      <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-fg-subtle" />
      <input
        ref={inputRef}
        type="search"
        enterKeyHint="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault()
            onChange('')
          }
        }}
        placeholder="Name or set code"
        aria-label="Search cards"
        autoFocus={FINE_POINTER}
        className={`${FIELD} h-11 w-full pl-11 pr-11 text-base [&::-webkit-search-cancel-button]:appearance-none`}
      />
      {value && (
        <IconButton
          icon="close"
          label="Clear search"
          size="sm"
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2"
        />
      )}
    </div>
  )
}

export default SearchBar
