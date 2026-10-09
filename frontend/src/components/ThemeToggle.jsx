import { memo } from 'react'
import { IconButton } from './controls'

function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === 'dark'
  return (
    <IconButton
      icon={isDark ? 'sun' : 'moon'}
      label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={onToggle}
      variant="outline"
    />
  )
}

export default memo(ThemeToggle)
