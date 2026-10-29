import { useEffect } from 'react'

// Page scroll is locked while any dialog is open. Counted, so nested
// dialogs (a card opened over the price list, the lightbox over a card)
// unlock only when the last one closes, whatever order they close in.
// The lock is on <html> (the page's scroller); scrollbar-gutter in index.css
// keeps the layout from shifting when the scrollbar goes away. The body is
// not position:fixed'd: that would unstick the sticky header behind the
// dialog and jump the page.
let locks = 0

export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined
    if (locks++ === 0) document.documentElement.classList.add('scroll-locked')
    return () => {
      if (--locks === 0) document.documentElement.classList.remove('scroll-locked')
    }
  }, [active])
}
