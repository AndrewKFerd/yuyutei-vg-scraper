import { useState } from 'react'
import { MAX_QTY } from '../useCalculator'

const buttonClass =
  'flex h-8 w-8 items-center justify-center rounded-full border border-line-strong text-base font-semibold leading-none text-fg transition hover:border-accent hover:text-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:border-line-strong aria-disabled:hover:text-fg'

// [-] 3 [+]. While the field is being typed in, `draft` holds the raw text
// (so "" and "150" can exist briefly); the real value is reported as soon as
// there's a number, and the text snaps to the clamped value on blur.
// The ends use aria-disabled, not disabled: a button that disables itself
// while focused drops keyboard focus to <body>.
// "-" stops at 1: taking a card out is the Remove button's job.
function QtyStepper({ value, onChange, label }) {
  const [draft, setDraft] = useState(null)

  const step = (delta) => {
    if (value + delta < 1 || value + delta > MAX_QTY) return
    setDraft(null)
    onChange(Math.min(MAX_QTY, Math.max(1, value + delta)))
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button type="button" onClick={() => step(-1)} aria-disabled={value <= 1} aria-label={`Decrease quantity of ${label}`} className={buttonClass}>
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_QTY}
        value={draft ?? String(value)}
        aria-label={`Quantity of ${label}`}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 3)
          setDraft(digits)
          if (digits !== '') onChange(Math.min(MAX_QTY, Math.max(1, Number(digits))))
        }}
        onBlur={() => {
          if (draft === null) return
          setDraft(null)
          onChange(Math.min(MAX_QTY, Math.max(1, Number(draft) || 1)))
        }}
        className="w-10 rounded-full border border-transparent bg-transparent py-1 text-center text-sm font-semibold tabular-nums text-fg outline-none [appearance:textfield] focus:border-accent [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button type="button" onClick={() => step(1)} aria-disabled={value >= MAX_QTY} aria-label={`Increase quantity of ${label}`} className={buttonClass}>
        +
      </button>
    </div>
  )
}

export default QtyStepper
