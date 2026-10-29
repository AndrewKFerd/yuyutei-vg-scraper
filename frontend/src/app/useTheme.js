import { useCallback, useEffect, useState } from 'react'
import { applyTheme, getThemePreference, resolveTheme, saveThemePreference, systemDarkQuery } from '../ui/theme'

/**
 * The theme preference ('light' | 'dark' | 'system') and the theme it
 * resolves to. 'system' follows the OS live. Only setPreference stores
 * anything, so a first visit doesn't pin whatever the OS said that day.
 */
export function useTheme() {
  const [preference, setPreferenceState] = useState(getThemePreference)
  const [resolved, setResolved] = useState(() => resolveTheme(preference))

  useEffect(() => {
    setResolved(resolveTheme(preference))
    if (preference !== 'system') return undefined
    const query = systemDarkQuery()
    if (!query) return undefined
    const onChange = () => setResolved(resolveTheme('system'))
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [preference])

  // theme-init.js already applied the first one before paint; this keeps
  // <html> in step afterwards.
  useEffect(() => {
    applyTheme(resolved)
  }, [resolved])

  const setPreference = useCallback((next) => {
    saveThemePreference(next)
    setPreferenceState(next)
  }, [])

  return { preference, resolved, setPreference }
}
