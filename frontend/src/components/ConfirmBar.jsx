import { useEffect, useRef } from 'react'
import { Button } from './controls'

// Yes/no for a destructive step, in place of window.confirm. Focus starts on
// Cancel, so a stray Enter doesn't do the destructive thing.
function ConfirmBar({ text, confirmLabel, danger = false, onConfirm, onCancel }) {
  const cancelRef = useRef(null)
  useEffect(() => cancelRef.current?.focus({ preventScroll: true }), [])
  return (
    <div
      role="group"
      aria-label={text}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-highlight-line bg-highlight px-3 py-2 text-sm text-fg sm:px-4"
    >
      <p className="min-w-0 flex-1 basis-60">{text}</p>
      <span className="flex items-center gap-2">
        <Button size="sm" variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button ref={cancelRef} size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </span>
    </div>
  )
}

export default ConfirmBar
