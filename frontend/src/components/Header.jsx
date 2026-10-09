import { useEffect, useState } from 'react'
import ThemeToggle from './ThemeToggle'
import CurrencySelector from './CurrencySelector'
import Logo from './Logo'
import { IconButton, Segmented } from './controls'
import { formatDateTime, isoToMinute, timeAgo } from '../history'
import { CONTAINER } from '../ui'

const VIEWS = [
  ['search', 'Search'],
  ['movers', 'Market Movers'],
]

// Re-render once a minute so "updated 25m ago" keeps counting.
function useMinuteTick() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

// "28,123 cards · updated 25m ago [↻]": how fresh the numbers on
// screen are is the first thing a price tool should answer.
function Freshness({ meta, onRefresh, isRefreshing, refreshError }) {
  const now = useMinuteTick()
  const minute = meta ? isoToMinute(meta.generatedAt) : null
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
      {meta ? (
        <>
          <span>{meta.count.toLocaleString()} cards</span>
          {minute !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span title={`Prices last updated ${formatDateTime(minute)}`}>updated {timeAgo(minute, now)}</span>
            </>
          )}
          <IconButton
            icon="refresh"
            size="sm"
            label={isRefreshing ? 'Checking for newer prices…' : 'Check for newer prices'}
            onClick={onRefresh}
            disabled={isRefreshing}
            className={`-my-1 disabled:cursor-wait ${isRefreshing ? '[&>svg]:animate-spin' : ''}`}
          />
          {refreshError && (
            <span role="alert" title={refreshError} className="basis-full text-negative">
              Couldn’t check for newer prices — still showing the ones you had.
            </span>
          )}
        </>
      ) : (
        <span>Loading the card catalog…</span>
      )}
    </div>
  )
}

function Header({ meta, theme, onToggleTheme, view, onViewChange, currency, onCurrencyChange, onRefresh, isRefreshing, refreshError }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className={`${CONTAINER} flex flex-wrap items-center gap-x-5 gap-y-2 py-3`}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Logo className="h-9 w-9 shrink-0" />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-extrabold leading-tight tracking-tight text-fg sm:text-xl">
              Yuyu-tei Card Search
            </h1>
            <Freshness meta={meta} onRefresh={onRefresh} isRefreshing={isRefreshing} refreshError={refreshError} />
          </div>
        </div>

        <div className="order-last flex w-full items-center justify-between gap-2 sm:order-none sm:w-auto sm:justify-end">
          <Segmented label="View" options={VIEWS} value={view} onChange={onViewChange} />
          <CurrencySelector value={currency} onChange={onCurrencyChange} />
        </div>

        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
    </header>
  )
}

export default Header
