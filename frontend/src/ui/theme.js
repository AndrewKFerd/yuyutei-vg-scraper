// Light/dark theme, driven by a `.dark` class on <html> (see the
// @custom-variant in index.css). The preference is 'light', 'dark' or
// 'system'; only an explicit light/dark choice is stored, so 'system' keeps
// following the OS (including changes while the page is open -- see
// app/useTheme.js). public/theme-init.js (loaded from index.html's <head>)
// runs an equivalent check before React loads, so the first paint is already
// the right theme -- keep the two in sync if you change the key or logic.
import { THEME_COLOR } from './palette'

export const THEME_KEY = 'yuyutei:theme'
export const THEME_PREFERENCES = ['light', 'dark', 'system']

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** @returns {'light' | 'dark' | 'system'} */
export function getThemePreference() {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // storage unavailable -- follow the OS
  }
  return 'system'
}

/** Stores an explicit choice; 'system' clears it. */
export function saveThemePreference(preference) {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, preference)
  } catch {
    // fine -- it just won't persist across visits
  }
}

export const systemDarkQuery = () => window.matchMedia?.(DARK_QUERY)

/** @returns {'light' | 'dark'} */
export function resolveTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference
  return systemDarkQuery()?.matches ? 'dark' : 'light'
}

/**
 * Puts `theme` on the page: the `.dark` class and the browser's
 * theme-color. Transitions are held off for the swap, so every control
 * changes at once instead of fading at its own speed.
 * @param {'light' | 'dark'} theme
 */
export function applyTheme(theme) {
  const root = document.documentElement
  const dark = theme === 'dark'
  if (root.classList.contains('dark') !== dark) {
    root.classList.add('theme-switching')
    root.classList.toggle('dark', dark)
    // Apply the new colors now, with transitions still off, then let them back.
    void getComputedStyle(root).color
    setTimeout(() => root.classList.remove('theme-switching'), 1)
  }
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', THEME_COLOR[theme])
  }
}
