import { useCallback, useEffect, useMemo, useState } from 'react'

// The card modal's "Translate" toggle for cards whose rules text is only in
// Japanese. The translator (src/translate) is a separate chunk, loaded the
// first time someone turns translation on. The choice is remembered per
// browser, so the next Japanese-only card opens already translated.

export const TRANSLATE_KEY = 'yuyutei:translateRules'

function readPreference() {
  try {
    return localStorage.getItem(TRANSLATE_KEY) === '1'
  } catch {
    return false
  }
}

function writePreference(on) {
  try {
    if (on) localStorage.setItem(TRANSLATE_KEY, '1')
    else localStorage.removeItem(TRANSLATE_KEY)
  } catch {
    // fine — it just won't persist across visits
  }
}

let enginePromise = null
function loadEngine() {
  // A failed load (offline) isn't cached, so the next attempt retries.
  enginePromise ??= import('./translate').catch((err) => {
    enginePromise = null
    throw err
  })
  return enginePromise
}

// One name index per catalog array: built on the first translation, and
// again only after a catalog refresh hands over a new array.
const nameIndexes = new WeakMap()

/**
 * `card`: the open card merged with its detail shard. `cards`: the whole
 * catalog, for resolving card names quoted in the text.
 * Returns { offered, on, toggle, retry, status: 'idle'|'loading'|'ready'|'error',
 * result, translateTerm }. While translation is on the engine loads for
 * every card, not only Japanese-only ones, since the modal's kind and clan
 * pills (Japanese for all cards) take their English from its
 * `translateTerm`: null until it has loaded.
 */
export function useRulesTranslation(card, cards) {
  const [on, setOn] = useState(readPreference)
  const [attempt, setAttempt] = useState(0)
  // { attempt, engine }: the loaded translator, or engine null when that
  // attempt's load failed.
  const [loaded, setLoaded] = useState(null)

  useEffect(() => {
    if (!on) return
    let cancelled = false
    loadEngine().then(
      (engine) => {
        if (!cancelled) setLoaded({ attempt, engine })
      },
      () => {
        if (!cancelled) setLoaded({ attempt, engine: null })
      }
    )
    return () => {
      cancelled = true
    }
  }, [on, attempt])

  const offered = Boolean(card?.skillTextJp && !card.skillTextEn)
  const textJp = offered ? card.skillTextJp : null
  const setCode = card?.setCode
  const nameJp = card?.nameJp
  const nameEn = card?.nameEn
  const engine = on ? loaded?.engine || null : null
  const failed = on && loaded?.attempt === attempt && !loaded.engine

  // { result } or { error } (a translator bug shouldn't take the modal down).
  const outcome = useMemo(() => {
    if (!engine || !textJp) return null
    try {
      let names = cards ? nameIndexes.get(cards) : null
      if (cards && !names) {
        names = engine.buildNameIndex(cards)
        nameIndexes.set(cards, names)
      }
      return { result: engine.translateRules(textJp, { card: { setCode, nameJp, nameEn }, names }) }
    } catch (error) {
      console.warn('[translate] Couldn’t translate this card’s text.', error)
      return { error }
    }
  }, [engine, textJp, setCode, nameJp, nameEn, cards])

  const toggle = useCallback(() => {
    setOn((was) => {
      writePreference(!was)
      return !was
    })
  }, [])
  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return {
    offered,
    on,
    toggle,
    retry,
    status: !on || !textJp ? 'idle' : outcome?.result ? 'ready' : failed || outcome?.error ? 'error' : 'loading',
    result: outcome?.result || null,
    translateTerm: engine ? engine.translateTerm : null,
  }
}
