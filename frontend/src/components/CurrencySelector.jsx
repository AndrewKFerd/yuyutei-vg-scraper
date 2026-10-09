import { memo } from 'react'
import { CURRENCIES } from '../currency'
import { Select } from './controls'

const LABELS = { JPY: 'JPY (¥)', USD: 'USD ($)', SGD: 'SGD (S$)', IDR: 'IDR (Rp)' }

function CurrencySelector({ value, onChange, className = '' }) {
  return (
    <Select value={value} onChange={onChange} label="Display currency" className={className}>
      {CURRENCIES.map((code) => (
        <option key={code} value={code}>
          {LABELS[code] || code}
        </option>
      ))}
    </Select>
  )
}

export default memo(CurrencySelector)
