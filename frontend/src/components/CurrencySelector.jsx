import { memo } from 'react'
import { CURRENCIES } from '../currency'

const LABELS = { JPY: 'JPY (¥)', USD: 'USD ($)', SGD: 'SGD (S$)', IDR: 'IDR (Rp)' }

function CurrencySelector({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Display currency"
      className="w-full rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100 sm:w-auto dark:border-night-600 dark:bg-night-800 dark:text-gold-500 dark:focus:border-brand-500 dark:focus:ring-brand-500/20"
    >
      {CURRENCIES.map((code) => (
        <option key={code} value={code}>
          {LABELS[code] || code}
        </option>
      ))}
    </select>
  )
}

export default memo(CurrencySelector)
