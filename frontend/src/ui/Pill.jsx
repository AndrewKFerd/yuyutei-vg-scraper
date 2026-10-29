import Icon from './icons'
import { pillClass } from './classes'

/**
 * A small rounded label: a card stat, a status chip. `variant` is one of
 * pillClass()'s; `className` adds the tone (text/border colors).
 * @param {{ variant?: 'stat' | 'outline', icon?: string, className?: string, children: import('react').ReactNode }} props
 */
export function Pill({ variant = 'stat', icon, className = '', children }) {
  return (
    <span className={`${pillClass(variant)} ${className}`}>
      {icon && <Icon name={icon} className="h-3.5 w-3.5 shrink-0" />}
      {children}
    </span>
  )
}

/**
 * An active filter with its own remove button. The button's hit area is a
 * full 32px; negative margins keep the chip itself compact.
 */
export function RemovablePill({ children, onRemove, removeLabel }) {
  return (
    <span className={pillClass('filter')}>
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        title={removeLabel}
        className="-my-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-2 hover:text-fg"
      >
        <Icon name="close" className="h-3.5 w-3.5" />
      </button>
    </span>
  )
}
