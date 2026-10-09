import { memo } from 'react'
import { Select } from './controls'

// Rarity list is small (a dozen or so codes), so a plain <select> is fine
// here — unlike the set list (300+), it doesn't need a searchable combobox.
function RarityFilter({ options, value, onChange, className = '' }) {
  return (
    <Select value={value} onChange={onChange} label="Filter by rarity" className={className}>
      <option value="">All rarities</option>
      {options.map((rarity) => (
        <option key={rarity} value={rarity}>
          {rarity}
        </option>
      ))}
    </Select>
  )
}

export default memo(RarityFilter)
