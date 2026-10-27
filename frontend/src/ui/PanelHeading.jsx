import { forwardRef } from 'react'
import { IconButton } from './controls'

// The top of an inline panel (Export lists, Import deck): its title, which
// takes focus when the panel opens, a line on what it's for, and a close
// button.
const PanelHeading = forwardRef(function PanelHeading(
  /** @type {{ id: string, title: import('react').ReactNode, children: import('react').ReactNode, onClose: () => void }} */ {
    id,
    title,
    children,
    onClose,
  },
  /** @type {import('react').ForwardedRef<HTMLHeadingElement>} */ ref
) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h3 id={id} ref={ref} tabIndex={-1} className="text-base font-bold text-fg outline-none">
          {title}
        </h3>
        <p className="text-xs text-fg-muted">{children}</p>
      </div>
      <IconButton icon="close" size="sm" label="Close" onClick={onClose} />
    </div>
  )
})

export default PanelHeading
