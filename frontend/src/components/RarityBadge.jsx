import { memo } from 'react'

// Known rarity -> tailwind color classes. Anything not listed here falls
// back to the neutral "default" style below. Treated as an open string on
// purpose since yuyu-tei adds new rarity codes over time.
const RARITY_STYLES = {
  SEC: 'bg-amber-400 text-amber-950',
  SP: 'bg-amber-400 text-amber-950',
  FFR: 'bg-purple-500 text-white',
  SR: 'bg-purple-500 text-white',
  RRR: 'bg-pink-500 text-white',
  RR: 'bg-blue-500 text-white',
  R: 'bg-green-500 text-white',
  C: 'bg-gray-400 text-gray-900',
}

const DEFAULT_STYLE = 'bg-slate-300 text-slate-800'

function RarityBadge({ rarity }) {
  const style = RARITY_STYLES[rarity] || DEFAULT_STYLE
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide leading-none shadow-sm ${style}`}
    >
      {rarity || '?'}
    </span>
  )
}

export default memo(RarityBadge)
