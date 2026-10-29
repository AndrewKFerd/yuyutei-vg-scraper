import PriceHistoryChart from './PriceHistoryChart'
import { Button } from '../../ui/controls'
import { formatPrice } from '../../lib/currency'
import { formatDate, formatDateTime, formatPctSigned, isoToMinute, pctChange } from '../../lib/format'
import { describeChangeTime, getSeries, newerThanCatalog, summarizeSeries } from '../../data/history'
import { stockInfo } from '../../lib/stock'
import { SECTION_HEADING } from '../../ui/classes'
import Notice from '../../ui/Notice'
import Skeleton from '../../ui/Skeleton'

// Shown when history recorded a change after the visitor's cached catalog
// was built, so the footer's price/stock (from that catalog) is out of date.
function StaleCatalogNote({ latest, catalogMinute, currency, rates, onRefresh, isRefreshing, refreshError }) {
  const [at, price, stock] = latest
  return (
    <Notice
      tone="warning"
      className="leading-relaxed"
      action={
        onRefresh && (
          <Button variant="link" size="inline" onClick={onRefresh} disabled={isRefreshing}>
            {isRefreshing ? 'Refreshing…' : 'Refresh now'}
          </Button>
        )
      }
    >
      <span className="font-semibold">Newer data:</span> {formatPrice(price, currency, rates)} ·{' '}
      {stockInfo(stock).label} as of {formatDateTime(at)} — the price and stock shown below are from your cached
      catalog ({formatDateTime(catalogMinute)}).
      {onRefresh && refreshError && (
        <span role="alert" className="mt-1 block text-negative">
          Refresh failed ({refreshError}).
        </span>
      )}
    </Notice>
  )
}

// The card modal's "Price history" block. `history` is undefined while
// loading, null when the history file isn't available (then the section
// just doesn't show -- history is an extra, never an error state), else
// history-public.json.
function PriceHistorySection({
  card,
  history,
  currency,
  rates,
  catalogGeneratedAt,
  onRefresh,
  isRefreshing,
  refreshError,
}) {
  if (history === undefined) {
    return (
      <section className="flex flex-col gap-2">
        <h3 className={SECTION_HEADING}>Price history</h3>
        <Skeleton label="Loading price history" className="h-36 w-full rounded-sm sm:h-40" />
      </section>
    )
  }
  if (history === null) return null

  const heading = <h3 className={SECTION_HEADING}>Price history</h3>

  const series = getSeries(history, card.id)
  // Cards whose only entry is the tracking baseline are stripped from the
  // public file, so "absent" means "no change since tracking began".
  if (!series) {
    return (
      <section className="flex flex-col gap-1">
        {heading}
        <p className="text-xs text-fg-muted">
          Price unchanged since tracking began ({formatDate(history.trackingSince, { year: true })}).
        </p>
      </section>
    )
  }

  const fmt = (p) => formatPrice(p, currency, rates)
  const { low, high, changes, lastChange, firstSeen } = summarizeSeries(series)
  const firstSeenLater = firstSeen > history.trackingSince
  // Drawing needs some width: a listing first seen in the latest run is a
  // single point in time, which reads better as text.
  const chartable = history.lastRun - firstSeen >= 60
  const lastPct = lastChange ? pctChange(lastChange.from, lastChange.to) : null
  const strong = 'font-semibold text-fg'
  const catalogMinute = isoToMinute(catalogGeneratedAt)
  const newer = newerThanCatalog(series, card, catalogMinute)

  return (
    <section className="flex flex-col gap-2">
      {newer && (
        <StaleCatalogNote
          latest={newer}
          catalogMinute={catalogMinute}
          currency={currency}
          rates={rates}
          onRefresh={onRefresh}
          isRefreshing={isRefreshing}
          refreshError={refreshError}
        />
      )}
      {chartable ? (
        <PriceHistoryChart
          key={card.id}
          series={series}
          coverage={history.coverage}
          lastRun={history.lastRun}
          currency={currency}
          rates={rates}
        />
      ) : (
        heading
      )}
      <div className="flex flex-col gap-0.5 text-xs text-fg-muted">
        {changes > 0 ? (
          <p>
            Low <span className={strong}>{fmt(low)}</span> · High <span className={strong}>{fmt(high)}</span> ·{' '}
            {changes} {changes === 1 ? 'change' : 'changes'}
          </p>
        ) : (
          <p>
            No price changes since {firstSeenLater ? 'first seen' : 'tracking began'} (
            {formatDate(firstSeen, { year: true })}) · <span className={strong}>{fmt(low)}</span>
          </p>
        )}
        {lastChange && (
          <p>
            Last change{' '}
            {lastPct !== null && (
              <span className={`font-semibold ${lastPct > 0 ? 'text-positive' : 'text-negative'}`}>
                {formatPctSigned(lastPct)}
              </span>
            )}{' '}
            ({fmt(lastChange.from)} → {fmt(lastChange.to)}) · changed{' '}
            {describeChangeTime(lastChange.at, history.coverage)}
          </p>
        )}
        {firstSeenLater && changes > 0 && <p>First seen {formatDate(firstSeen, { year: true })}.</p>}
      </div>
    </section>
  )
}

export default PriceHistorySection
