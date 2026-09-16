function Header({ meta }) {
  return (
    <header className="border-b border-gold-300 bg-gradient-to-b from-brand-50 to-white px-4 pb-6 pt-8 text-center">
      <h1 className="text-3xl font-extrabold tracking-tight text-brand-700 sm:text-4xl">
        Yuyu-tei Card Search
      </h1>
      <div className="mx-auto mt-2 h-1 w-16 rounded-full bg-gold-400" />
      {meta && (
        <p className="mt-3 text-sm text-slate-500">
          Full Vanguard catalog — {meta.count.toLocaleString()} cards
        </p>
      )}
    </header>
  )
}

export default Header
