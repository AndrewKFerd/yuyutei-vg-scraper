// Live updates (src/data/deltas.js): when a loaded catalog can be patched with
// price/stock deltas, and what patching does to the cards.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyDeltas, planCatchUp } from '../src/data/deltas.js'

const T1 = '2026-10-29T10:00:00.000Z'
const T2 = '2026-10-29T10:30:00.000Z'
const T3 = '2026-10-29T11:00:00.000Z'

const ref = (from, to) => ({ from, to, key: `deltas/${to.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}.json`, n: 1 })
const meta = (over = {}) => ({
  v: 1,
  generatedAt: T3,
  structHash: 'h',
  deltas: [ref(T1, T2), ref(T2, T3)],
  ...over,
})
const loaded = (generatedAt, structHash = 'h') => ({ generatedAt, structHash })

describe('planCatchUp', () => {
  it('does nothing when the page is current, or newer than a lagging meta', () => {
    assert.deepEqual(planCatchUp(meta(), loaded(T3)), { action: 'none' })
    assert.deepEqual(planCatchUp(meta({ generatedAt: T2, deltas: [ref(T1, T2)] }), loaded(T3)), { action: 'none' })
  })

  it('patches with every delta from the loaded build onwards', () => {
    assert.deepEqual(planCatchUp(meta(), loaded(T1)), {
      action: 'patch',
      keys: ['deltas/20261029T103000Z.json', 'deltas/20261029T110000Z.json'],
    })
    assert.deepEqual(planCatchUp(meta(), loaded(T2)).keys, ['deltas/20261029T110000Z.json'])
  })

  it('reloads when the structure changed or the page has no hash', () => {
    assert.equal(planCatchUp(meta({ structHash: 'other' }), loaded(T1)).action, 'reload')
    assert.equal(planCatchUp(meta(), { generatedAt: T1 }).action, 'reload')
    assert.equal(planCatchUp(meta(), {}).action, 'reload')
  })

  it('reloads when the chain does not reach back, is broken, or stops short', () => {
    assert.equal(planCatchUp(meta({ deltas: [] }), loaded(T1)).action, 'reload')
    assert.equal(planCatchUp(meta(), loaded('2026-10-29T09:00:00.000Z')).action, 'reload')
    assert.equal(planCatchUp(meta({ deltas: [ref(T1, T2), ref('2026-10-29T10:45:00.000Z', T3)] }), loaded(T1)).action, 'reload')
    assert.equal(planCatchUp(meta({ deltas: [ref(T1, T2)] }), loaded(T1)).action, 'reload')
  })
})

describe('applyDeltas', () => {
  const card = (id, price, stock, extra = {}) => ({ id, price, stock, priceDisplay: `¥${price}`, ...extra })
  const delta = (changes) => ({ v: 1, from: T1, to: T2, changes })

  it('keeps untouched cards as the same objects and returns the same array for no changes', () => {
    const cards = [card('a/1', 100, 1), card('a/2', 200, 1)]
    assert.equal(applyDeltas(cards, [delta([])]), cards)
    const out = applyDeltas(cards, [delta([['a/2', 250, 1]])])
    assert.notEqual(out, cards)
    assert.equal(out[0], cards[0])
    assert.notEqual(out[1], cards[1])
  })

  it('updates price, display and stock, and drops the stale 7-day change on a price move', () => {
    const cards = [card('a/1', 100, 1, { chg7d: { from: 90, at: 5 } }), card('a/2', 200, 1, { chg7d: { from: 190, at: 5 } })]
    const [moved, restocked] = applyDeltas(cards, [delta([['a/1', 150, 0], ['a/2', 200, 4]])])
    assert.deepEqual([moved.price, moved.priceDisplay, moved.stock, 'chg7d' in moved], [150, '¥150', 0, false])
    assert.deepEqual([restocked.price, restocked.stock, restocked.chg7d], [200, 4, { from: 190, at: 5 }])
  })

  it('lets a later delta win, ignores unknown ids, and returns a card to unchanged', () => {
    const cards = [card('a/1', 100, 1)]
    const out = applyDeltas(cards, [delta([['a/1', 120, 1], ['zz/9', 5, 5]]), delta([['a/1', 130, 1]])])
    assert.equal(out[0].price, 130)
    assert.equal(applyDeltas(cards, [delta([['a/1', 100, 1]])])[0], cards[0])
  })
})
