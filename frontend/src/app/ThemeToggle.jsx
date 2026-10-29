import { memo } from 'react'
import { IconButton } from '../ui/controls'
import { THEME_PREFERENCES } from '../ui/theme'

const LABELS = { light: 'Light', dark: 'Dark', system: 'System' }
const ICONS = { light: 'sun', dark: 'moon', system: 'system' }

// One button that steps light → dark → system. The icon shows the current
// preference; the label also says what the next click does.
function ThemeToggle({ preference, resolved, onChange }) {
  const next = THEME_PREFERENCES[(THEME_PREFERENCES.indexOf(preference) + 1) % THEME_PREFERENCES.length]
  const current = preference === 'system' ? `System (${LABELS[resolved].toLowerCase()})` : LABELS[preference]
  return (
    <IconButton
      icon={ICONS[preference]}
      label={`Theme: ${current}. Switch to ${LABELS[next].toLowerCase()}.`}
      onClick={() => onChange(next)}
      variant="outline"
    />
  )
}

export default memo(ThemeToggle)
