// Shared catalog helpers (src/lib/catalogFormat.js, src/lib/format.js).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { withCurrent } from '../src/lib/catalogFormat.js'
import { plural } from '../src/lib/format.js'

describe('withCurrent', () => {
  const card = { id: 'a/1', price: 500, stock: 1, priceDisplay: '¥500', chg7d: { from: 400, at: 1 } }

  it('is the same object when nothing differs', () => {
    assert.equal(withCurrent(card, 500, 1), card)
  })

  it('takes a new stock and keeps the rest', () => {
    assert.deepEqual(withCurrent(card, 500, 0), { ...card, stock: 0 })
  })

  it('takes a new price with its display, and drops the stale 7-day change', () => {
    const next = withCurrent(card, 1480, 0)
    assert.equal(next.priceDisplay, '¥1,480')
    assert.equal(next.price, 1480)
    assert.equal('chg7d' in next, false)
    // The catalog's own object is left alone.
    assert.equal(card.price, 500)
  })
})

describe('plural', () => {
  it('words a count', () => {
    assert.equal(plural(1, 'card', 'cards'), '1 card')
    assert.equal(plural(1200, 'card', 'cards'), '1,200 cards')
  })
})
