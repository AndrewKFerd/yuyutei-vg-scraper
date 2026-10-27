import Icon from './icons'
import { Button } from './controls'

// The highlighted note for something that's off -- the catalog didn't load,
// browser storage refused a write, a window is only partly covered: an info
// icon and a line or two of text. `role="alert"` when it appears in
// response to something going wrong.
export default function WarningNote({ role = undefined, className = '', children }) {
  return (
    <p
      role={role}
      className={`flex items-start gap-2 rounded-lg border border-highlight-line bg-highlight px-3 py-2 text-xs text-fg ${className}`}
    >
      <Icon name="info" className="mt-px h-4 w-4 text-warning" />
      <span>{children}</span>
    </p>
  )
}

/** "Couldn't load the card catalog, so … [Try again]", for a view that works without it. */
export function CatalogErrorNote({ onRetry, children }) {
  return (
    <WarningNote role="alert" className="mt-3">
      {children}{' '}
      <Button variant="link" size="inline" onClick={onRetry}>
        Try again
      </Button>
    </WarningNote>
  )
}
