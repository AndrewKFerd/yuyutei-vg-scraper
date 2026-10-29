import { EmptyMark } from './Logo'

/**
 * The "nothing here" block of a view: the faint mark with an icon, a title,
 * a line or two of explanation (`children`, as <p>s) and an optional action.
 * `role="alert"` when it stands in for something that failed.
 * @param {{ icon: string, title: string, role?: string, action?: import('react').ReactNode,
 *   className?: string, children?: import('react').ReactNode }} props
 */
export default function EmptyState({ icon, title, role = undefined, action = null, className = '', children = null }) {
  return (
    <div role={role} className={`mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center ${className}`}>
      <EmptyMark icon={icon} />
      <p className="text-base font-semibold text-fg">{title}</p>
      {children && <div className="flex flex-col gap-2 text-sm text-fg-muted">{children}</div>}
      {action}
    </div>
  )
}
