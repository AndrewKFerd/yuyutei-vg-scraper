// Which in-page navigation gets its own browser-history entry
// (src/lib/navigation.js), so Back closes a card and returns to the
// previous view.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { historyAction } from '../src/lib/navigation.js'

const at = (view, cardId = null) => ({ view, cardId })

describe('historyAction', () => {
  it('pushes a view change', () => {
    assert.equal(historyAction(at('search'), at('movers'), null), 'push')
  })

  it('pushes opening a card', () => {
    assert.equal(historyAction(at('search'), at('search', 'a/1'), null), 'push')
  })

  it('replaces stepping between cards and edits within a view', () => {
    assert.equal(historyAction(at('search', 'a/1'), at('search', 'a/2'), { cardOverlay: true }), 'replace')
    assert.equal(historyAction(at('search'), at('search'), null), 'replace')
  })

  it('steps back over a pushed card when it closes in the page', () => {
    assert.equal(historyAction(at('search', 'a/1'), at('search'), { cardOverlay: true }), 'back')
  })

  it('replaces closing a card that came with the page (a shared link)', () => {
    assert.equal(historyAction(at('search', 'a/1'), at('search'), null), 'replace')
  })
})
