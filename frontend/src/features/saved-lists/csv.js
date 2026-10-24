import { derivedDetailUrl } from '../../lib/catalogFormat'

// A saved list's sheet as CSV, for Export CSV.

const CSV_HEAD = [
  'Card',
  'Japanese name',
  'Number',
  'Rarity',
  'Qty',
  'Unit price (JPY)',
  'Subtotal (JPY)',
  'Price now (JPY)',
  'Subtotal now (JPY)',
  'Link',
]

function csvCell(value) {
  if (value == null) return ''
  if (typeof value === 'number') return String(value)
  // A leading = + - @ (or tab / CR, which some spreadsheets skip past) would
  // have the spreadsheet run the text as a formula.
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// Plain JPY numbers (not the display currency), so the columns add up in a
// spreadsheet and don't depend on an exchange rate.
/** The sheet's rows and totals row as CSV text (CRLF lines, no BOM). */
export function sheetToCsv(rows, totals) {
  const lines = [CSV_HEAD]
  for (const row of rows) {
    lines.push([
      row.nameEn || row.nameJp,
      row.nameJp,
      row.setCode,
      row.rarity,
      row.qty,
      row.price,
      row.subtotal,
      row.now,
      row.nowSubtotal,
      row.card ? row.card.detailUrl : derivedDetailUrl(row.id),
    ])
  }
  lines.push(['Total', null, null, null, totals.copies, null, totals.savedJpy, null, totals.nowJpy, null])
  return lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n')
}
