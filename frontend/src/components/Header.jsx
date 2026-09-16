import ThemeToggle from './ThemeToggle'

function Header({ meta, theme, onToggleTheme }) {
  return (
    <header className="relative border-b border-gold-300 bg-gradient-to-b from-brand-50 to-white px-16 pb-6 pt-8 text-center sm:px-4 dark:border-gold-700/40 dark:from-night-800 dark:to-night-900">
      {/* px-16 on small screens keeps the centered title clear of this
          absolutely-positioned toggle (44px + right-4 gutter) on both sides
          so it stays visually centered instead of colliding with it. */}
      <div className="absolute right-4 top-4">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight text-brand-700 sm:text-4xl dark:text-brand-500">
        Yuyu-tei Card Search
      </h1>
      <div className="mx-auto mt-2 h-1 w-16 rounded-full bg-gold-400 dark:bg-gold-500" />
      {meta && (
        <p className="mt-3 text-sm text-slate-500 dark:text-gold-500/70">
          Full Vanguard catalog — {meta.count.toLocaleString()} cards
        </p>
      )}
    </header>
  )
}

export default Header
