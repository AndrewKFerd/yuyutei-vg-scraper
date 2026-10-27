// The watchlist's comparisons (src/features/watchlist/watchlistData.js):
// what counts as a change since a card was last looked at.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as W from '../src/features/watchlist/watchlistData.js'

const state = (price, stock, at = 100) => ({ price, stock, at })
const item = (over = {}) => ({
  id: 'dzbt01/1',
  addedAt: 50,
  target: null,
  seen: state(1000, 2),
  snap: { nameEn: 'Card', nameJp: null, setCode: 'DZ-BT01/001', rarity: 'RR' },
  ...over,
})

describe('changesBetween', () => {
  it('reports nothing when price and stock agree', () => {
    assert.deepEqual(W.changesBetween(state(1000, 2), state(1000, 2), null), [])
  })

  it('ignores a stock count moving while still in stock', () => {
    assert.deepEqual(W.changesBetween(state(1000, 3), state(1000, 1), null), [])
    assert.deepEqual(W.changesBetween(state(1000, 3), state(1000, null), null), [])
  })

  it('sees restocks, sell-outs and price moves', () => {
    assert.deepEqual(W.changesBetween(state(1000, 0), state(1000, 4), null), ['restocked'])
    assert.deepEqual(W.changesBetween(state(1000, 2), state(1000, 0), null), ['soldOut'])
    assert.deepEqual(W.changesBetween(state(1000, 2), state(800, 2), null), ['down'])
    assert.deepEqual(W.changesBetween(state(1000, 0), state(1200, null), null), ['restocked', 'up'])
  })

  it('flags a target only when it is newly reachable, in stock', () => {
    assert.deepEqual(W.changesBetween(state(1000, 2), state(800, 2), 900), ['target', 'down'])
    // Already at the target when seen: not news again.
    assert.deepEqual(W.changesBetween(state(800, 2), state(700, 2), 900), ['down'])
    // Cheap enough but sold out: not reachable.
    assert.deepEqual(W.changesBetween(state(1000, 2), state(800, 0), 900), ['down', 'soldOut'])
    // Came back in stock under the target.
    assert.deepEqual(W.changesBetween(state(800, 0), state(800, 1), 900), ['target', 'restocked'])
  })
})

describe('currentState', () => {
  const card = { price: 1000, stock: 2 }

  it('uses the catalog when history has nothing newer', () => {
    assert.deepEqual(W.currentState(card, [[10, 900, 1], [50, 1000, 2]], 60, 90), state(1000, 2, 90))
    assert.deepEqual(W.currentState(card, null, 60, 90), state(1000, 2, 90))
  })

  it('uses a history entry recorded after the catalog', () => {
    assert.deepEqual(W.currentState(card, [[50, 1000, 2], [70, 1000, 0]], 60, 90), state(1000, 0, 90))
  })
})

describe('eventsSince', () => {
  const series = [
    [10, 1000, 2],
    [20, 1000, 0],
    [30, 1000, 3],
    [40, 900, 3],
    [50, 900, 1],
    [60, 900, 0],
  ]

  it('lists stock crossings and price moves after the minute, newest first', () => {
    assert.deepEqual(W.eventsSince(series, 25), [
      { at: 60, kind: 'soldOut' },
      { at: 40, kind: 'down', from: 1000, to: 900 },
      { at: 30, kind: 'restocked' },
    ])
  })

  it('has nothing for a card with no history', () => {
    assert.deepEqual(W.eventsSince(null, 0), [])
  })
})

describe('watchRow and sortRows', () => {
  const ctx = (card, series = null) => ({ card, series, catalogMinute: 100, asOf: 120 })

  it('marks a restock in between snapshots as news even when it sold out again', () => {
    const row = W.watchRow(item({ seen: state(1000, 0, 100) }), ctx({ price: 1000, stock: 0 }, [[90, 1000, 0], [110, 1000, 1], [115, 1000, 0]]))
    assert.deepEqual(row.changes, [])
    assert.equal(row.events.length, 2)
    assert.equal(row.news, true)
  })

  it('keeps a card the catalog lost, without news', () => {
    const row = W.watchRow(item(), ctx(null))
    assert.equal(row.card, null)
    assert.equal(row.news, false)
  })

  it('puts the most notable news first, then the rest newest-added first', () => {
    const quiet = W.watchRow(item({ id: 'a', addedAt: 1 }), ctx({ price: 1000, stock: 2 }))
    const quietNewer = W.watchRow(item({ id: 'b', addedAt: 2 }), ctx({ price: 1000, stock: 2 }))
    const up = W.watchRow(item({ id: 'c' }), ctx({ price: 1100, stock: 2 }))
    const restock = W.watchRow(item({ id: 'd', seen: state(1000, 0) }), ctx({ price: 1000, stock: 1 }))
    const gone = W.watchRow(item({ id: 'e' }), ctx(null))
    assert.deepEqual(
      W.sortRows([gone, quiet, up, quietNewer, restock]).map((row) => row.item.id),
      ['d', 'c', 'b', 'a', 'e']
    )
  })
})

describe('sanitizeWatchlist', () => {
  it('drops junk and repeats, and cleans targets', () => {
    const items = W.sanitizeWatchlist([
      item({ target: '1,200' }),
      item(),
      null,
      { id: '' },
      { id: 'x', seen: 'nope', target: -5, snap: { nameEn: 3 } },
    ])
    assert.equal(items.length, 2)
    assert.equal(items[0].target, 1200)
    assert.deepEqual(items[1], {
      id: 'x',
      addedAt: 0,
      target: null,
      seen: { price: null, stock: null, at: 0 },
      snap: { nameEn: null, nameJp: null, setCode: null, rarity: null },
    })
  })

  it('reads a target typed with a yen sign, and clears an empty one', () => {
    assert.equal(W.cleanTarget('¥980'), 980)
    assert.equal(W.cleanTarget(''), null)
    assert.equal(W.cleanTarget('abc'), null)
  })
})
