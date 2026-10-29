import { useEffect, useRef } from 'react'
import { DEFAULT_MOVER_WINDOW, MOVER_WINDOWS } from '../data/history'
import { isTransferHash } from '../features/saved-lists/listTransfer'
import { SORT_OPTIONS } from '../lib/sorting'
import { historyAction } from '../lib/navigation'

// Shareable URL state, no router dependency. Search view: ?q= (text),
// &set=<slug>, &rarity=, &sort= and &page= (defaults left out). Movers:
// ?view=movers, &w=24h|30d (the 7d default is left out) and &nation=<code>.
// Saved lists: ?view=lists (the lists themselves are local to the browser,
// so which one is open isn't shared); a #import= link of lists sent from
// another browser opens there too, whatever the query says (see
// listTransfer.js). Watchlist: ?view=watchlist (local to the browser too).
// Any view: &card=<id> opens that card's modal. Set,
// rarity and nation are checked against the catalog once it has loaded.

export const VIEWS = ['search', 'movers', 'lists', 'watchlist']
const SORT_KEYS = SORT_OPTIONS.map(([key]) => key)

/** The state the page opens with, from its URL. */
export function readUrlState() {
  const params = new URLSearchParams(window.location.search)
  const w = params.get('w')
  const sort = params.get('sort')
  const page = Number(params.get('page'))
  return {
    view: isTransferHash(window.location.hash) ? 'lists' : VIEWS.includes(params.get('view')) ? params.get('view') : 'search',
    moversWindow: MOVER_WINDOWS.includes(w) ? w : DEFAULT_MOVER_WINDOW,
    moversNation: params.get('nation') || '',
    cardId: params.get('card') || null,
    query: params.get('q') || '',
    setSlug: params.get('set') || '',
    rarity: params.get('rarity') || '',
    sort: SORT_KEYS.includes(sort) ? sort : 'default',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  }
}

/**
 * Mirrors the view, its filters and the open card into the URL so it can be
 * shared or reloaded, and keeps any other params plus the path and hash
 * untouched. A new view or an opened card gets its own history entry
 * (historyAction); everything else replaces the current one. Back/Forward
 * hand the entry's view and card to `onNavigate(urlState)`.
 * `page` is left out when the results aren't paged (a set is picked);
 * while the catalog is still loading (`catalogLoading`), a pending ?card=
 * is left alone.
 */
export function useUrlSync({
  view,
  moversWindow,
  moversNation,
  query,
  setSlug,
  rarity,
  sort,
  page,
  paged,
  cardId,
  catalogLoading,
  onNavigate,
}) {
  // What the current history entry shows, to tell a step from an edit.
  const shown = useRef({ view, cardId: cardId || readUrlState().cardId })
  const navigate = useRef(onNavigate)
  useEffect(() => {
    navigate.current = onNavigate
  })

  useEffect(() => {
    const onPopState = () => {
      const state = readUrlState()
      // Already in the entry: the re-render this causes must not push again.
      shown.current = { view: state.view, cardId: state.cardId }
      navigate.current?.(state)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const action = historyAction(shown.current, { view, cardId }, window.history.state)
    shown.current = { view, cardId }
    if (action === 'back') {
      window.history.back()
      return
    }

    const params = new URLSearchParams(window.location.search)
    const put = (key, value) => (value ? params.set(key, value) : params.delete(key))
    const search = view === 'search'
    const movers = view === 'movers'
    put('view', search ? '' : view)
    put('w', movers && moversWindow !== DEFAULT_MOVER_WINDOW ? moversWindow : '')
    put('nation', movers ? moversNation : '')
    put('q', search ? query.trim() : '')
    put('set', search ? setSlug : '')
    put('rarity', search ? rarity : '')
    put('sort', search && sort !== 'default' ? sort : '')
    put('page', search && paged && page > 1 ? String(page) : '')
    if (cardId) params.set('card', cardId)
    else if (!catalogLoading) params.delete('card')
    // "/" is legal in a query string; leaving it unescaped keeps shared
    // links readable (?card=dzbt14/10318 rather than dzbt14%2F10318).
    const next = params.toString().replace(/%2F/gi, '/')
    const { pathname, search: current, hash } = window.location
    const url = `${pathname}${next ? `?${next}` : ''}${hash}`
    if (action === 'push') {
      window.history.pushState({ cardOverlay: Boolean(cardId) }, '', url)
    } else if (url !== `${pathname}${current}${hash}`) {
      window.history.replaceState(window.history.state, '', url)
    }
  }, [view, moversWindow, moversNation, query, setSlug, rarity, sort, page, paged, cardId, catalogLoading])
}
