import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from './icons'
import { FIELD, buttonClass } from './classes'

// Shared building blocks, so the same control looks and behaves the same
// everywhere (see classes.js for the class recipes, and the token and shape
// notes in index.css).

/**
 * @typedef {Omit<import('react').ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
 *   variant?: 'primary' | 'secondary' | 'ghost' | 'link' | 'danger',
 *   size?: 'sm' | 'md' | 'inline',
 *   type?: 'button' | 'submit' | 'reset',
 *   [dataAttribute: `data-${string}`]: unknown,
 * }} ButtonProps
 */

export const Button = forwardRef(function Button(
  /** @type {ButtonProps} */ { variant = 'secondary', size = 'md', className = '', type = 'button', ...rest },
  /** @type {import('react').ForwardedRef<HTMLButtonElement>} */ ref
) {
  return <button ref={ref} type={type} className={`${buttonClass(variant, size)} ${className}`} {...rest} />
})

const ICON_BUTTON_SIZES = {
  sm: ['h-8 w-8', 'h-4 w-4'],
  md: ['h-10 w-10', 'h-5 w-5'],
  lg: ['h-11 w-11', 'h-5 w-5'],
}

/**
 * @typedef {Omit<import('react').ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
 *   icon: string,
 *   label: string,
 *   size?: 'sm' | 'md' | 'lg',
 *   variant?: 'ghost' | 'outline',
 *   type?: 'button' | 'submit' | 'reset',
 *   [dataAttribute: `data-${string}`]: unknown,
 * }} IconButtonProps
 */

/** Round, icon-only button; `label` is its accessible name and tooltip. */
export const IconButton = forwardRef(function IconButton(
  /** @type {IconButtonProps} */ { icon, label, size = 'md', variant = 'ghost', className = '', type = 'button', ...rest },
  /** @type {import('react').ForwardedRef<HTMLButtonElement>} */ ref
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
  const pad = size === 'sm' ? 'min-h-7 px-2.5 text-[11px]' : 'min-h-8 px-3 text-sm sm:px-4'
  const pill = useSlidingPill(value)
  return (
    <div
      ref={pill.groupRef}
      role="group"
      aria-label={label}
      className={`relative inline-flex rounded-full border border-line-strong bg-surface p-0.5 shadow-sm ${className}`}
    >
      {pill.box && (
        <span
          aria-hidden="true"
          style={{ width: pill.box.w, transform: `translateX(${pill.box.x}px)` }}
          className={`absolute inset-y-0.5 left-0 rounded-full bg-accent-solid shadow-sm ${
            pill.box.animate ? 'transition-[transform,width] duration-200 ease-out' : ''
          }`}
        />
      )}
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={`relative flex-1 whitespace-nowrap rounded-full font-semibold transition ${pad} ${
            value !== key
              ? 'text-fg-muted hover:text-accent'
              : // Until the pill has measured itself, the button paints its own.
                pill.box
                ? 'text-on-accent'
                : 'bg-accent-solid text-on-accent shadow-sm'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

// The selected option's background, as one pill that slides between
// options instead of jumping. Measured from the pressed button (offsetLeft
// is relative to the group, which is `relative`), and again whenever the
// group resizes (labels that change with the screen width). Not animated
// until it has a real measurement, so it doesn't slide in from nowhere on
// first paint or when a hidden group is first shown.
function useSlidingPill(value) {
  const groupRef = useRef(null)
  const measured = useRef(false)
  const [box, setBox] = useState(null)

  const measure = useCallback(() => {
    const active = groupRef.current?.querySelector('[aria-pressed="true"]')
    if (!active || active.offsetWidth === 0) {
      measured.current = false
      return
    }
    const next = { x: active.offsetLeft, w: active.offsetWidth, animate: measured.current }
    measured.current = true
    setBox((prev) => (prev && prev.x === next.x && prev.w === next.w ? prev : next))
  }, [])

  useLayoutEffect(measure, [value, measure])

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(groupRef.current)
    return () => observer.disconnect()
  }, [measure])

  return { groupRef, box }
}
