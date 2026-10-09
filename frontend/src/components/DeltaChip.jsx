import { memo } from 'react'
import { formatPctMagnitude, pctChange } from '../history'

// "Up/down since" chip: ▲25% (green) / ▼67% (red). Direction is carried by
// the arrow and the aria-label as well as the color, so it never relies on
// red/green alone.
//
// variant "overlay" is a solid pill for sitting on top of card art (tiles);
// "inline" is a soft tint for use next to text (modal footer).
const STYLES = {
  overlay: {
    up: 'bg-green-700 text-white shadow-sm',
    down: 'bg-red-600 text-white shadow-sm',
  },
  inline: {
    up: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-positive',
    down: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-negative',
  },
}

function DeltaChip({ from, to, period = '7 days', suffix, variant = 'inline' }) {
  const pct = pctChange(from, to)
  if (pct === null || pct === 0) return null

  const up = pct > 0
  const magnitude = formatPctMagnitude(pct)
  return (
    <span
      role="img"
      aria-label={`${up ? 'Up' : 'Down'} ${magnitude} in ${period}`}
      title={`${up ? 'Up' : 'Down'} ${magnitude} in ${period}`}
      className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded px-1 py-0.5 text-[10px] font-bold leading-none tabular-nums ${
        STYLES[variant][up ? 'up' : 'down']
      }`}
    >
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      {magnitude}
      {suffix && <span className="font-medium opacity-80">{suffix}</span>}
    </span>
  )
}

export default memo(DeltaChip)
