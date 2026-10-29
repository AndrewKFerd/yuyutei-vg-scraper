// Browser-history policy for the page's own navigation (app/useUrlState.js).

/**
 * How a change of view or open card should reach the browser's history, so
 * Back undoes what a visitor would call a step:
 *  - 'push'    a new view, or a card opened: Back returns from it;
 *  - 'back'    a card we pushed was closed in the page: step back over its
 *              entry rather than leave it for Back to land on again;
 *  - 'replace' anything else (filters, paging, stepping between cards).
 * `prev`/`next` are { view, cardId }; `entry` is history.state.
 * @param {{ view: string, cardId: string | null }} prev
 * @param {{ view: string, cardId: string | null }} next
 * @param {{ cardOverlay?: boolean } | null | undefined} entry
 * @returns {'push' | 'back' | 'replace'}
 */
export function historyAction(prev, next, entry) {
  if (prev.view !== next.view) return 'push'
  if (!prev.cardId && next.cardId) return 'push'
  if (prev.cardId && !next.cardId && entry?.cardOverlay) return 'back'
  return 'replace'
}
