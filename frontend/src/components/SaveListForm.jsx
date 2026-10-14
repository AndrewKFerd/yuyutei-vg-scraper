import { useEffect, useId, useRef, useState } from 'react'
import { Button } from './controls'
import { MAX_NAME_LENGTH } from '../useSavedLists'
import { FIELD } from '../ui'

/**
 * Inline "name this list" field for saving the price list (and renaming a
 * saved one). Opens with `defaultName` selected, so typing replaces it and
 * Enter keeps it. `onSubmit(name)` returns an error message to show, or
 * null when done. Escape cancels without reaching a dialog's own Escape
 * handler on the document (which would close the whole dialog).
 */
function SaveListForm({ label, submitLabel, defaultName, onSubmit, onCancel, disabled = false }) {
  const [name, setName] = useState(defaultName)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)
  const id = useId()

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
    inputRef.current?.select()
  }, [])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!disabled) setError(onSubmit(name.trim() || defaultName))
      }}
      className="flex flex-col gap-1.5"
    >
      <label htmlFor={id} className="text-xs font-semibold text-fg-muted">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id={id}
          value={name}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="off"
          placeholder={defaultName}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${FIELD} min-w-0 flex-1 basis-40 px-4`}
        />
        <span className="flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={disabled}>
            {submitLabel}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </span>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-semibold text-negative">
          {error}
        </p>
      )}
    </form>
  )
}

export default SaveListForm
