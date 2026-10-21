import { useEffect, useRef, useState } from 'react'
import Logo from './Logo'
import Icon from './icons'

// A saved list's PDF being made, shown wherever the user has gone since
// (App renders this, so switching views doesn't lose it). The job is
// { id, progress (0-1), status: 'working' | 'done' | 'error', message }.

// How long "Downloaded" (once the count reaches it) and a failure stay up.
const DONE_MS = 1800
const ERROR_MS = 4000

// Counts the shown value up to `target`, easing in on it frame by frame, so
// a jump from 3 cards of 10 to 4 reads as 30% climbing to 40% rather than a
// step. Straight to the target for anyone who asked for less motion.
function useCountUp(target) {
  const [shown, setShown] = useState(0)
  const shownRef = useRef(0)
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    const step = () => {
      const prev = shownRef.current
      const next = reduce ? target : Math.min(target, prev + Math.max(0.3, (target - prev) * 0.12))
      shownRef.current = next
      setShown(next)
      if (next < target) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target])
  return shown
}

// The square card in the corner: the mark playing as the loader over a
// percentage that climbs as the card art comes in, then a tick and
// "Downloaded" for a moment (timed from when the count gets there, so a
// quick export still shows it), or a warning if it failed. The progressbar
// reports the real progress, not the eased count, so it doesn't change
// every frame.
function Toast({ job, raised, onClear }) {
  const shown = useCountUp(job.status === 'done' ? 100 : Math.round(job.progress * 100))
  const failed = job.status === 'error'
  const done = job.status === 'done' && shown >= 100
  const percent = Math.floor(shown)

  useEffect(() => {
    if (!done && !failed) return
    const timer = setTimeout(() => onClear(job.id), failed ? ERROR_MS : DONE_MS)
    return () => clearTimeout(timer)
  }, [done, failed, job.id, onClear])

  // Under dialogs (z-40 and up), and above the price list bar when it's
  // showing; on wide screens the bar is narrower than the page, so the
  // corner is free. Nothing in it is clickable, so taps go through to
  // whatever it covers. It scales with the screen: 30vw, from 6.5rem on
  // the narrowest phones up to 9rem, with its contents in proportion.
  const bottom = raised
    ? 'bottom-[calc(6.5rem+env(safe-area-inset-bottom))] xl:bottom-[calc(1rem+env(safe-area-inset-bottom))]'
    : 'bottom-[calc(1rem+env(safe-area-inset-bottom))]'
  return (
    <div className={`pointer-events-none fixed right-3 z-30 animate-rise sm:right-4 ${bottom}`}>
      <div
        role="progressbar"
        aria-label="Making PDF"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(job.progress * 100)}
        className="flex size-[clamp(6.5rem,30vw,9rem)] flex-col items-center justify-center gap-[6%] rounded-2xl border border-line bg-surface p-[11%] text-center shadow-lg"
      >
        <Logo animated={!done && !failed} className="aspect-square h-[34%] w-auto" />
        <span className="flex h-[22%] items-center text-[clamp(1.125rem,5.5vw,1.5rem)] font-bold tabular-nums leading-none text-fg">
          {failed ? (
            <Icon name="info" className="size-[clamp(1.375rem,7vw,1.75rem)] text-warning" />
          ) : done ? (
            <Icon name="check" className="size-[clamp(1.375rem,7vw,1.75rem)] animate-pop text-positive" />
          ) : (
            `${percent}%`
          )}
        </span>
        <span className="whitespace-nowrap text-[clamp(0.625rem,3vw,0.75rem)] leading-tight text-fg-muted">
          {failed ? 'Couldn’t make PDF' : done ? 'Downloaded' : 'Making PDF…'}
        </span>
        <span aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
          <span
            className={`block h-full rounded-full ${failed ? 'bg-warning' : 'bg-accent-solid'}`}
            style={{ width: `${shown}%` }}
          />
        </span>
      </div>
    </div>
  )
}

/**
 * The toast plus a live region for the job's messages (starting, done,
 * failed), always mounted so they're read out on any view. `onClear(id)`
 * drops the job once its toast has had its moment.
 */
export default function PdfToast({ job, raised, onClear }) {
  return (
    <>
      <p className="sr-only" aria-live="polite">
        {job?.message}
      </p>
      {/* Keyed, so a second export starts from 0% with its own entrance. */}
      {job && <Toast key={job.id} job={job} raised={raised} onClear={onClear} />}
    </>
  )
}
