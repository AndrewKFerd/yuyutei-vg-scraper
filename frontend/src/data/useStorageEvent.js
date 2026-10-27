import { useEffect, useRef } from 'react'

/**
 * Calls `onChange(newValue)` when another tab writes localStorage `key`
 * (`newValue` is null when it was removed). The handler can change between
 * renders without re-subscribing.
 * @param {string} key
 * @param {(newValue: string | null) => void} onChange
 */
export function useStorageEvent(key, onChange) {
  const handlerRef = useRef(onChange)
  useEffect(() => {
    handlerRef.current = onChange
  })
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === key) handlerRef.current(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [key])
}
