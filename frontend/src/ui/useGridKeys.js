import { useCallback, useState } from 'react'

/**
 * Arrow-key movement through a grid of card tiles, so the grid is one Tab
 * stop (the active tile, plus its price-list toggle) instead of two per
 * card. Tiles mark themselves `data-tile={index}` and their main button
 * `data-tile-main`, their toggle `data-tile-toggle`; spread `gridProps` on
 * the element that holds them and give tile `i` tabIndex `i === active ? 0
 * : -1`. ←/→ step, ↑/↓ move a row (however many columns the layout has right
 * now), Home/End jump to the ends, and + toggles the focused card's place in
 * the price list.
 * @param {number} count how many tiles there are
 */
export function useGridKeys(count) {
  const [active, setActive] = useState(0)

  const onFocus = useCallback((e) => {
    const tile = e.target.closest?.('[data-tile]')
    if (tile) setActive(Number(tile.dataset.tile))
  }, [])

  const onKeyDown = useCallback((e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const tile = e.target.closest?.('[data-tile]')
    if (!tile) return
    if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      tile.querySelector('[data-tile-toggle]')?.click()
      return
    }
    const tiles = [...e.currentTarget.querySelectorAll('[data-tile]')]
    const i = tiles.indexOf(tile)
    const top = tiles[0].offsetTop
    const firstOfRow2 = tiles.findIndex((t) => t.offsetTop !== top)
    const columns = firstOfRow2 === -1 ? tiles.length : firstOfRow2
    const target = {
      ArrowRight: i + 1,
      ArrowLeft: i - 1,
      ArrowDown: i + columns,
      ArrowUp: i - columns,
      Home: 0,
      End: tiles.length - 1,
    }[e.key]
    if (target === undefined) return
    e.preventDefault()
    tiles[Math.max(0, Math.min(target, tiles.length - 1))].querySelector('[data-tile-main]')?.focus()
  }, [])

  return {
    // A grid that shrank (a new page, a filter) keeps its stop on a real tile.
    active: Math.min(active, Math.max(count - 1, 0)),
    gridProps: { onFocus, onKeyDown },
  }
}
