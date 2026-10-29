import { useRef } from 'react'
import Icon from '../../ui/icons'
import { useModal } from '../../ui/useModal'

// Full-screen view of the 500x700 scan. Tap/click anywhere, press Escape or
// activate the close button to dismiss. Sits above the card modal (z-60 vs
// 50); as the topmost modal it owns Escape and Tab while open (useModal), so
// closing it leaves the modal beneath open. Closing returns focus to the
// "enlarge" button.
function Lightbox({ src, alt, onClose }) {
  const ref = useRef(null)
  useModal(ref, { onClose })

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
        className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-overlay text-on-overlay hover:bg-night-700"
      >
        <Icon name="close" />
      </button>
    </div>
  )
}

export default Lightbox
