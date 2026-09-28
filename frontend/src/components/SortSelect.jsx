import { memo } from 'react'

// Values are the sort keys App.jsx's sortCards() understands. The 7-day
// sorts use each card's `chg7d` (baked into cards.json by the pipeline),
// so they work without downloading the price history file.
const OPTIONS = [
  ['default', 'Sort: Default'],
  ['price-asc', 'Price: low → high'],
  ['price-desc', 'Price: high → low'],
  ['rise-7d', 'Biggest 7d rise'],
  ['drop-7d', 'Biggest 7d drop'],
]

function SortSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Sort cards"
      className="w-full rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100 sm:w-auto dark:border-night-600 dark:bg-night-800 dark:text-gold-500 dark:focus:border-brand-500 dark:focus:ring-brand-500/20"
    >
      {OPTIONS.map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  )
}

export default memo(SortSelect)
