import { useEffect } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

/**
 * Keyboard focus for a modal dialog, so keyboard and screen-reader users
 * land in it and can't Tab out into the page hidden behind it:
 *  - while `open`: focus moves into `ref`'s element (give it tabIndex={-1})
 *    unless something inside it already has focus, and goes back to
 *    whatever had it before (e.g. the card tile) once `open` turns false or
 *    the component unmounts;
 *  - while `trap` (defaults to `open`): Tab / Shift+Tab cycle within it.
 *    Pass false while a nested dialog (the lightbox) owns the keyboard, so
 *    the two traps don't fight; focus isn't restored when only `trap`
 *    changes.
 */
export function useDialogFocus(ref, { open, trap = open }) {
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    const container = ref.current
    if (container && !container.contains(document.activeElement)) container.focus({ preventScroll: true })
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [ref, open])

  useEffect(() => {
    if (!trap) return
    const handleKeyDown = (e) => {
      const container = ref.current
      if (e.key !== 'Tab' || !container) return
      // Skip anything not rendered (e.g. inside a closed <details>).
      const items = Array.from(container.querySelectorAll(FOCUSABLE)).filter((el) => el.getClientRects().length > 0)
      if (items.length === 0) {
        e.preventDefault()
        container.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      const outside = !container.contains(current)
      if (e.shiftKey && (outside || current === first || current === container)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (outside || current === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [ref, trap])
}
