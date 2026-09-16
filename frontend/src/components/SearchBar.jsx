function SearchBar({ value, onChange }) {
  return (
    <div className="mx-auto w-full max-w-xl px-4">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Insert card name"
        autoFocus
        className="w-full rounded-full border border-slate-300 bg-white px-5 py-3 text-base text-slate-800 shadow-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
      />
    </div>
  )
}

export default SearchBar
