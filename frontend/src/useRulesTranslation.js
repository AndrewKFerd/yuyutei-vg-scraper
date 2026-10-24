import { useCallback, useEffect, useState } from 'react'

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
 * Returns { offered, on, toggle, retry, status: 'idle'|'loading'|'ready'|'error', result }.
 */
export function useRulesTranslation(card, cards) {
  const [on, setOn] = useState(readPreference)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ key: null, status: 'idle', result: null })

  const offered = Boolean(card?.skillTextJp && !card.skillTextEn)
  const textJp = offered ? card.skillTextJp : null
  const id = card?.id
  const setCode = card?.setCode
  const nameJp = card?.nameJp
  const nameEn = card?.nameEn
  const key = on && textJp ? `${id}|${attempt}|${textJp}` : null

  useEffect(() => {
    if (!key) return
    let cancelled = false
    loadEngine().then(
      (engine) => {
        if (cancelled) return
        let names = cards ? nameIndexes.get(cards) : null
        if (cards && !names) {
          names = engine.buildNameIndex(cards)
          nameIndexes.set(cards, names)
        }
        const result = engine.translateRules(textJp, { card: { setCode, nameJp, nameEn }, names })
        setState({ key, status: 'ready', result })
      },
      () => {
        if (!cancelled) setState({ key, status: 'error', result: null })
      }
    )
    return () => {
      cancelled = true
    }
  }, [key, textJp, setCode, nameJp, nameEn, cards])

  const toggle = useCallback(() => {
    setOn((was) => {
      writePreference(!was)
      return !was
    })
  }, [])
  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  const current = key && state.key === key
  return {
    offered,
    on,
    toggle,
    retry,
    status: !key ? 'idle' : current ? state.status : 'loading',
    result: current ? state.result : null,
  }
}
