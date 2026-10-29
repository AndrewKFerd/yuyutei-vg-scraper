import Icon from './icons'
import { IconButton } from './controls'

// One note box for every "by the way" on the page, in four tones:
//   info     neutral: a confirmation of something routine
//   success  something worked (an import, a save)
//   warning  something is partial or off but the page still works
//   error    something failed; usually paired with a retry action
// `onDismiss` adds a close button; `action` sits after the text. `layout`
// "strip" is the full-width bar form, for the top edge of a bordered panel
// (the saved-list sheet) rather than a box of its own.
const TONES = {
  info: { box: 'border-line bg-surface text-fg-muted', icon: 'info', iconClass: 'text-fg-muted' },
  success: { box: 'border-line bg-surface text-fg-muted', icon: 'check', iconClass: 'text-positive' },
  warning: { box: 'border-warning-line bg-warning-soft text-fg', icon: 'info', iconClass: 'text-warning' },
  error: { box: 'border-negative/40 bg-negative-soft text-fg', icon: 'info', iconClass: 'text-negative' },
}

const LAYOUTS = {
  box: 'items-start rounded-lg border px-3 py-2',
  strip: 'items-center border-b px-3 py-1.5 sm:px-4',
}

/**
 * @param {{ tone?: 'info' | 'success' | 'warning' | 'error', layout?: 'box' | 'strip', role?: string,
 *   icon?: string, action?: import('react').ReactNode, onDismiss?: () => void, className?: string,
 *   children: import('react').ReactNode }} props
 */
export default function Notice({
  tone = 'info',
  layout = 'box',
  role = undefined,
  icon,
  action = null,
  onDismiss,
  className = '',
  children,
}) {
  const look = TONES[tone]
  return (
    <div role={role} className={`flex gap-2 text-xs ${LAYOUTS[layout]} ${look.box} ${className}`}>
      <Icon name={icon || look.icon} className={`mt-px h-4 w-4 shrink-0 ${look.iconClass}`} />
      <p className="min-w-0 flex-1">
        {children}
        {action && <> {action}</>}
      </p>
      {onDismiss && <IconButton icon="close" size="sm" label="Dismiss" onClick={onDismiss} className="-my-1.5 -mr-1.5 shrink-0" />}
    </div>
  )
}
