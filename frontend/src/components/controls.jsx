import { forwardRef } from 'react'
import Icon from './icons'
import { FIELD, buttonClass } from '../ui'

// Shared building blocks, so the same control looks and behaves the same
// everywhere (see ui.js for the class recipes, and the token and shape notes
// in index.css).

export const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', className = '', type = 'button', ...rest },
  ref
) {
  return <button ref={ref} type={type} className={`${buttonClass(variant, size)} ${className}`} {...rest} />
})

const ICON_BUTTON_SIZES = {
  sm: ['h-8 w-8', 'h-4 w-4'],
  md: ['h-10 w-10', 'h-5 w-5'],
  lg: ['h-11 w-11', 'h-5 w-5'],
}

/** Round, icon-only button; `label` is its accessible name and tooltip. */
export const IconButton = forwardRef(function IconButton(
  { icon, label, size = 'md', variant = 'ghost', className = '', type = 'button', ...rest },
  ref
) {
  const [box, glyph] = ICON_BUTTON_SIZES[size]
  const look =
    variant === 'outline'
      ? 'border border-line-strong bg-surface text-fg-muted shadow-sm hover:border-accent hover:text-accent'
      : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-full transition ${box} ${look} ${className}`}
      {...rest}
    >
      <Icon name={icon} className={glyph} />
    </button>
  )
})

/** Native <select> in the pill style, with a drawn chevron so it matches across browsers. */
export function Select({ value, onChange, label, className = '', children, ...rest }) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={`${FIELD} w-full cursor-pointer appearance-none pl-4 pr-9`}
        {...rest}
      >
        {children}
      </select>
      <Icon name="chevronDown" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
    </span>
  )
}

/**
 * Pick-one button group (view tabs, time windows, chart ranges). `options`
 * is [[key, label], ...]; buttons report their state with aria-pressed.
 */
export function Segmented({ label, options, value, onChange, size = 'md', className = '' }) {
  const pad = size === 'sm' ? 'min-h-7 px-2.5 text-[11px]' : 'min-h-8 px-4 text-sm'
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex rounded-full border border-line-strong bg-surface p-0.5 shadow-sm ${className}`}
    >
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={`flex-1 whitespace-nowrap rounded-full font-semibold transition ${pad} ${
            value === key ? 'bg-accent-solid text-on-accent shadow-sm' : 'text-fg-muted hover:text-accent'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
