function Header({ meta }) {
  return (
    <header className="border-b border-slate-200 bg-white px-4 pb-6 pt-8 text-center">
      <h1 className="text-3xl font-extrabold tracking-tight text-blue-700 sm:text-4xl">
        Yuyu-tei Card Search
      </h1>
      {meta && (
        <p className="mt-1 text-sm text-slate-500">
          Full Vanguard catalog — {meta.count.toLocaleString()} cards
        </p>
      )}
    </header>
  )
}

export default Header
