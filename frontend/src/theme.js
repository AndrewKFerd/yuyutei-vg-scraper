// Light/dark theme, driven by a `.dark` class on <html> (see the
// @custom-variant in index.css). Persisted per browser; falls back to the
// OS preference when the user hasn't chosen explicitly. index.html runs an
// equivalent inline check before React loads so the first paint is already
// the right theme — keep the two in sync if you change the key or logic.

export const THEME_KEY = 'yuyutei:theme'

export function getInitialTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // storage unavailable — fall through to the OS preference
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // fine — it just won't persist across visits
  }
}
