/**
 * A pulsing placeholder block where content is loading. Size and shape come
 * from `className`; `label` makes it a status for screen readers
 * ("Loading price history"), otherwise it's decoration.
 * @param {{ className?: string, label?: string }} props
 */
export default function Skeleton({ className = '', label }) {
  return (
    <div
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`animate-pulse rounded bg-surface-2 ${className}`}
    />
  )
}
