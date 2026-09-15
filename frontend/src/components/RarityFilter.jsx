import { memo } from 'react'

// Rarity list is small (a dozen or so codes), so a plain <select> is fine
// here — unlike the set list (300+), it doesn't need a searchable combobox.
function RarityFilter({ options, value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filter by rarity"
      className="w-full rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 sm:w-auto"
    >
      <option value="">All Rarities</option>
      {options.map((rarity) => (
        <option key={rarity} value={rarity}>
          {rarity}
        </option>
      ))}
    </select>
  )
}

export default memo(RarityFilter)
