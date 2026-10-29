import { memo } from 'react'

// Known rarity -> tailwind color classes. Anything not listed here falls
// back to the neutral "default" style below. Treated as an open string on
// purpose since yuyu-tei adds new rarity codes over time. The same in both
// themes (a badge sits on card art as often as on a surface). Every pair
// clears 4.5:1 -- the badge text is small, so it needs it more than most;
// test/theme-contrast.test.js checks them, and pdfExport.js's RARITY_INK
// repeats them for print.
const RARITY_STYLES = {
  SEC: 'bg-gold-500 text-gold-900',
  SP: 'bg-gold-500 text-gold-900',
  FFR: 'bg-purple-700 text-white',
  SR: 'bg-purple-700 text-white',
  RRR: 'bg-pink-700 text-white',
  RR: 'bg-brand-700 text-white',
  R: 'bg-green-700 text-white',
  C: 'bg-slate-300 text-slate-800',
}

const DEFAULT_STYLE = 'bg-slate-200 text-slate-800'

function RarityBadge({ rarity }) {
  const style = RARITY_STYLES[rarity] || DEFAULT_STYLE
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide leading-none shadow-sm ${style}`}
    >
      {rarity || '?'}
    </span>
  )
}

export default memo(RarityBadge)
