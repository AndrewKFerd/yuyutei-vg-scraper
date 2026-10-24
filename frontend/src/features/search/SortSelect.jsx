import { memo } from 'react'
import { Select } from '../../ui/controls'
import { SORT_OPTIONS } from '../../lib/sorting'

function SortSelect({ value, onChange, className = '' }) {
  return (
    <Select value={value} onChange={onChange} label="Sort cards" className={className}>
      {SORT_OPTIONS.map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </Select>
  )
}

export default memo(SortSelect)
