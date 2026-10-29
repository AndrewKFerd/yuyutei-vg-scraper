import Notice from './Notice'
import { Button } from './controls'

/**
 * The note for something that's off but not broken -- browser storage
 * refused a write, a window is only partly covered. `role="alert"` when it
 * appears in response to something going wrong.
 */
export default function WarningNote({ role = undefined, className = '', children }) {
  return (
    <Notice tone="warning" role={role} className={className}>
      {children}
    </Notice>
  )
}

/** "Couldn't load the card catalog, so … [Try again]", for a view that works without it. */
export function CatalogErrorNote({ onRetry, children }) {
  return (
    <Notice
      tone="error"
      role="alert"
      className="mt-3"
      action={
        <Button variant="link" size="inline" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {children}
    </Notice>
  )
}
