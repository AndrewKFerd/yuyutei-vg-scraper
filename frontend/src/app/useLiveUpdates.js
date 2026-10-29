import { useEffect, useRef, useState } from 'react'
import { applyDeltas, fetchDelta, fetchMeta, planCatchUp } from '../data/deltas'

// How often the tab asks /api/meta whether a newer catalog is out. With push
// connected the poll is only a safety net.
const POLL_MS = 60 * 1000
const POLL_WITH_PUSH_MS = 5 * 60 * 1000
// After a reload to a given build, don't try that same build again for this
// long (a reload that fails or lands on an older copy must not loop).
const RELOAD_RETRY_MS = 5 * 60 * 1000

/**
 * Keeps the loaded catalog current: checks /api/meta every minute while the
 * tab is visible, on returning to the tab, and when the pipeline's push hint
 * arrives, then either patches in price/stock deltas or reloads the whole
 * catalog (see planCatchUp). Does nothing until the catalog has loaded.
 * Returns whether the push channel is connected (the header's "Live").
 *
 * @param {{
 *   ready: boolean,
 *   loaded: { generatedAt?: string, structHash?: string } | null,
 *   cards: import('../lib/types.js').Card[],
 *   applyPatch: (cards: import('../lib/types.js').Card[], generatedAt: string) => Promise<void>,
 *   reloadTo: (version: string) => Promise<void>,
 * }} options
 */
export function useLiveUpdates({ ready, loaded, cards, applyPatch, reloadTo }) {
  const [live, setLive] = useState(false)
  // The latest values, read by the long-lived check below.
  const latest = useRef({ loaded, cards, applyPatch, reloadTo })
  useEffect(() => {
    latest.current = { loaded, cards, applyPatch, reloadTo }
  })

  useEffect(() => {
    if (!ready) return undefined

    let cancelled = false
    let busy = false
    let pushConnected = false
    let timer = null
    let disconnect = null
    const reloaded = new Map() // build -> when we last tried to load it

    async function check() {
      if (busy || cancelled) return
      busy = true
      try {
        const meta = await fetchMeta()
        const current = latest.current
        const plan = planCatchUp(meta, current.loaded)
        if (cancelled || plan.action === 'none') return

        if (plan.action === 'patch') {
          try {
            const deltas = await Promise.all(plan.keys.map(fetchDelta))
            // The page may have reloaded or patched meanwhile.
            if (cancelled || latest.current.loaded?.generatedAt !== current.loaded?.generatedAt) return
            await current.applyPatch(applyDeltas(latest.current.cards, deltas), meta.generatedAt)
            return
          } catch {
            // A delta that can't be fetched or read: fall through to a full reload.
          }
        }

        const tried = reloaded.get(meta.generatedAt)
        if (tried && Date.now() - tried < RELOAD_RETRY_MS) return
        reloaded.set(meta.generatedAt, Date.now())
        await current.reloadTo(meta.generatedAt)
      } catch {
        // Offline, a 5xx, or no meta published yet: the next poll tries again.
      } finally {
        busy = false
      }
    }

    function schedule() {
      clearTimeout(timer)
      timer = setTimeout(
        () => {
          if (document.visibilityState === 'visible') check()
          schedule()
        },
        pushConnected ? POLL_WITH_PUSH_MS : POLL_MS
      )
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    import('../data/realtime')
      .then(({ connectRealtime }) =>
        connectRealtime({
          onUpdated: check,
          onStatus: (connected) => {
            pushConnected = connected
            if (cancelled) return
            setLive(connected)
            schedule()
          },
        })
      )
      .then((stop) => {
        if (cancelled) stop?.()
        else disconnect = stop
      })
      .catch(() => {})

    check()
    schedule()

    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      disconnect?.()
      setLive(false)
    }
  }, [ready])

  return live
}
