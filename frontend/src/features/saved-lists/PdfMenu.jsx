import { useId, useLayoutEffect, useRef, useState } from 'react'
import Icon from '../../ui/icons'
import { Button } from '../../ui/controls'
import { formatDate } from '../../lib/format'
import { focusSoon } from '../../ui/useDialogFocus'

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

export default PdfMenu
