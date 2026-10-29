import { useEffect, useId, useSyncExternalStore } from 'react'
import { useDialogFocus } from './useDialogFocus'
import { useScrollLock } from './useScrollLock'

// The plumbing every modal dialog shares: a stack of the open ones, so only
// the topmost answers Escape and traps Tab (a card opened over the price
// list, the lightbox over a card), plus focus in/out and the scroll lock.

const stack = []
const listeners = new Set()
const notify = () => listeners.forEach((listener) => listener())
const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Makes `ref`'s element (role="dialog", tabIndex={-1}) a modal while `open`.
 * Escape calls `onClose` when this is the topmost modal. Returns whether it
 * is, for dialogs with keys of their own (the card modal's ←/→).
 * @param {import('react').RefObject<HTMLElement>} ref
 * @param {{ open?: boolean, onClose?: () => void }} options
 */
export function useModal(ref, { open = true, onClose }) {
  const id = useId()

  useEffect(() => {
    if (!open) return undefined
    stack.push(id)
    notify()
    return () => {
      const i = stack.lastIndexOf(id)
      if (i !== -1) stack.splice(i, 1)
      notify()
    }
  }, [open, id])

  const isTop = useSyncExternalStore(
    subscribe,
    () => stack[stack.length - 1] === id,
    () => false
  )

  useDialogFocus(ref, { open, trap: open && isTop })
  useScrollLock(open)

  useEffect(() => {
    if (!open || !isTop || !onClose) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, isTop, onClose])

  return open && isTop
}
