import { useEffect, useRef } from 'react'
import Icon from '../../ui/icons'
import { useDialogFocus } from '../../ui/useDialogFocus'

// Full-screen view of the 500x700 scan. Tap/click anywhere, press Escape or
// activate the close button to dismiss. Sits above the card modal (z-60 vs
// 50) and stops propagation so closing it doesn't also close the modal
// beneath. Owns keyboard focus while open; closing returns it to the
// "enlarge" button.
function Lightbox({ src, alt, onClose }) {
  const ref = useRef(null)
  useDialogFocus(ref, { open: true })

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    // Capture phase so this runs before the modal's own Escape handler.
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} — full-size image`}
      tabIndex={-1}
      onMouseDown={(e) => {
        e.stopPropagation()
        onClose()
      }}
      className="fixed inset-0 z-[60] flex animate-fade cursor-zoom-out items-center justify-center bg-night-950/90 p-3 outline-none"
    >
      <img src={src} alt={alt} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
      {/* Pointer users already closed it on mousedown above; onClick is
          for keyboard activation (Enter/Space fire click, not mousedown). */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close full-size image"
        className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-night-800/80 text-white hover:bg-night-700"
      >
        <Icon name="close" />
      </button>
    </div>
  )
}

export default Lightbox
