import { useEffect, useRef, useState } from 'react'
import ThemeToggle from './ThemeToggle'
import CurrencySelector from './CurrencySelector'
import Logo from '../ui/Logo'
import { IconButton, Segmented } from '../ui/controls'
import { formatDateTime, isoToMinute, timeAgo } from '../lib/format'
import { CONTAINER } from '../ui/classes'
import BannerCollage from './BannerCollage'

// Short labels until lg: from md the switcher shares the title's row, and
// the full ones would squeeze the title there. The watchlist's tab carries
// how many watched cards changed since they were last looked at.
function viewOptions(watchNews) {
  return [
    ['search', 'Search'],
    [
      'movers',
      <>
        <span className="lg:hidden">Movers</span>
        <span className="hidden lg:inline">Market Movers</span>
      </>,
    ],
    [
      'lists',
      <>
        <span className="lg:hidden">Lists</span>
        <span className="hidden lg:inline">Saved lists</span>
      </>,
    ],
    [
      'watchlist',
      <span className="inline-flex items-center gap-1.5">
        <span className="lg:hidden">Watch</span>
        <span className="hidden lg:inline">Watchlist</span>
        {watchNews > 0 && (
          <span className="min-w-5 rounded-full bg-accent-2-solid px-1.5 text-[11px] font-bold leading-5 tabular-nums text-on-accent-2">
            {watchNews}
            <span className="sr-only"> changed</span>
          </span>
        )}
      </span>,
    ],
  ]
}

// Re-render once a minute so "updated 25m ago" keeps counting.
function useMinuteTick() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

// `on`, but only once it has stayed on for `delay` ms, so a quick refresh
// doesn't flash the loading animation. Off follows straight away.
function useDelayedFlag(on, delay) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!on) return
    const id = setTimeout(() => setShown(true), delay)
    return () => {
      clearTimeout(id)
      setShown(false)
    }
  }, [on, delay])
  return on && shown
}

// Whether `ref`'s element (the banner) has scrolled out of view, for the
// sticky bar's compact title.
function useScrolledPast(ref) {
  const [past, setPast] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(([entry]) => setPast(!entry.isIntersecting))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return past
}

// "Live" while push is connected: new prices arrive by themselves. Gold
// on the banner's navy, with a soft pulse where motion is welcome.
function LiveBadge() {
  return (
    <span
      title="Connected: new prices appear here as soon as they're published"
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gold-500/50 bg-gold-500/15 px-2 py-px text-[11px] font-semibold leading-4 text-gold-200"
    >
      <span aria-hidden="true" className="relative flex h-1.5 w-1.5">
        <span className="absolute inset-0 rounded-full bg-gold-500 opacity-60 motion-safe:animate-ping" />
        <span className="relative h-1.5 w-1.5 rounded-full bg-gold-500" />
      </span>
      Live
    </span>
  )
}

// "28,123 cards · updated 25m ago [↻]": how fresh the numbers on
// screen are is the first thing a price tool should answer. The refresh
// button overhangs the line (negative margins) so it doesn't make the row
// taller than its text. Sits on the banner, so its colors are for navy.
function Freshness({ meta, live, onRefresh, isRefreshing, refreshError }) {
  const now = useMinuteTick()
  const minute = meta ? isoToMinute(meta.generatedAt) : null
  return (
    <div className="flex min-h-5 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-5 text-white/80 sm:text-sm">
      {meta ? (
        <>
          {live && <LiveBadge />}
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
            variant="onDark"
            label={isRefreshing ? 'Checking for newer prices…' : 'Check for newer prices'}
            onClick={onRefresh}
            disabled={isRefreshing}
            className="-my-1.5 -ml-1 disabled:cursor-wait pointer-coarse:-my-2.5"
          />
          {refreshError && (
            <span role="alert" title={refreshError} className="basis-full text-red-300">
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

// The page's banner: the title over a wall of DZ-BT17 card art
// (BannerCollage), on a navy gradient until the scans arrive.
// Scrolls away; the sticky bar below it keeps the views in reach.
function Banner({ meta, live, animateLogo, onRefresh, isRefreshing, refreshError, currencyPicker, bannerRef, artUrls }) {
  return (
    <div
      ref={bannerRef}
      className="relative isolate overflow-hidden bg-gradient-to-br from-night-950 via-brand-900 to-brand-800"
    >
      <BannerCollage urls={artUrls} className="absolute inset-0 -z-10 h-full w-full" />
      {/* Keeps the title readable over the art: darkest behind the text,
          the cards showing through towards the right; phones, where the
          text spans the band, get a little more. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-r from-night-950/90 via-night-950/50 to-night-950/5"
      />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-night-950/60 to-transparent" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-night-950/35 sm:hidden" />
      <div className={`${CONTAINER} flex min-h-40 flex-col justify-center gap-2 py-6 sm:min-h-52`}>
        <div className="flex items-center gap-3 sm:gap-4">
          {/* The mark doubles as the loading indicator (catalog load, refresh). */}
          <Logo animated={animateLogo} className="h-11 w-11 shrink-0 rounded-[10px] shadow-lg ring-1 ring-gold-500/40 sm:h-14 sm:w-14 sm:rounded-xl" />
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold leading-tight tracking-tight text-white drop-shadow min-[400px]:text-2xl sm:text-4xl">
              Yuyu-tei Card Search
            </h1>
            <p className="text-xs font-medium text-gold-200 sm:text-sm">
              Every Cardfight!! Vanguard single on Yuyu-tei, in English, priced live.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Freshness meta={meta} live={live} onRefresh={onRefresh} isRefreshing={isRefreshing} refreshError={refreshError} />
          {/* Phones: the currency picker lives up here, so the sticky bar
              below fits on one row. */}
          <div className="sm:hidden">{currencyPicker}</div>
        </div>
      </div>
    </div>
  )
}

function Header({
  meta,
  live,
  bannerUrls,
  busy,
  theme,
  view,
  onViewChange,
  watchNews,
  currency,
  onCurrencyChange,
  onRefresh,
  isRefreshing,
  refreshError,
}) {
  const animateLogo = useDelayedFlag(busy, 300)
  const bannerRef = useRef(null)
  // Once the banner has scrolled away, the sticky bar shows a small mark and
  // title so the page still says what it is.
  const compact = useScrolledPast(bannerRef)
  const currencyPicker = <CurrencySelector value={currency} onChange={onCurrencyChange} />
  return (
    <>
      <Banner
        bannerRef={bannerRef}
        meta={meta}
        live={live}
        animateLogo={animateLogo}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        refreshError={refreshError}
        currencyPicker={currencyPicker}
        artUrls={bannerUrls}
      />
      <header className="site-header sticky top-0 z-30 bg-surface/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-surface/85">
        <div className={`${CONTAINER} flex items-center gap-3 py-2`}>
          <div
            aria-hidden={!compact}
            className={`hidden min-w-0 items-center gap-2 transition-opacity md:flex ${compact ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          >
            <Logo animated={animateLogo} className="h-7 w-7 shrink-0" />
            <span className="truncate text-sm font-extrabold tracking-tight text-fg">Yuyu-tei Card Search</span>
          </div>
          <nav aria-label="Views" className="flex min-w-0 flex-1 items-center gap-2 md:justify-end">
            <Segmented label="View" options={viewOptions(watchNews)} value={view} onChange={onViewChange} />
            <span className="hidden sm:contents">{currencyPicker}</span>
          </nav>
          <ThemeToggle preference={theme.preference} resolved={theme.resolved} onChange={theme.setPreference} />
        </div>
        {/* Blue into gold along the bar's bottom edge. */}
        <div aria-hidden="true" className="brand-stripe h-0.5" />
      </header>
    </>
  )
}

export default Header
