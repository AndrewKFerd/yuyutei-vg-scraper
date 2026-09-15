import { memo } from 'react'

// Simple <select> narrowing the grid to one set at a time, populated from
// whatever distinct setSlug values are present in the loaded catalog.
// Combines (AND) with the text search rather than replacing it.
function SetFilter({ options, value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filter by set"
      className="w-full rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 sm:w-auto"
    >
      <option value="">All Sets</option>
      {options.map((slug) => (
        <option key={slug} value={slug}>
          {slug}
        </option>
      ))}
    </select>
  )
}

export default memo(SetFilter)
