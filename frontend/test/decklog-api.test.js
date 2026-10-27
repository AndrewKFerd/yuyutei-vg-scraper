// The Deck Log proxy (api/decklog/[code].js) end to end, with Deck Log
// itself replaced by a fake fetch: what it asks for, and what it answers.
import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import handler, { readJsonCapped } from '../api/decklog/[code].js'

const DECK = {
  title: 'Pサヴァス',
  game_title_id: 1,
  list: [{ card_number: 'V-BT11/001', num: 3, name: '天羅水将 ランブロス', rare: 'VR' }],
  sub_list: [],
  p_list: [],
}

// A minimal stand-in for Node's ServerResponse.
function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(body = '') {
      this.body = body
    },
    json() {
      return JSON.parse(this.body)
    },
  }
}

async function call(req) {
  const res = fakeRes()
  await handler({ method: 'GET', ...req }, res)
  return res
}

const answer = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

describe('api/decklog', () => {
  const realFetch = globalThis.fetch
  const realError = console.error
  let calls

  beforeEach(() => {
    calls = []
    console.error = () => {}
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    console.error = realError
  })
  const upstream = (respond) => {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init })
      return respond()
    }
  }

  it('passes on a Vanguard deck, trimmed, briefly cached', async () => {
    upstream(() => answer(DECK))
    const res = await call({ query: { code: 'a7g1' } })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.json(), {
      code: 'A7G1',
      title: 'Pサヴァス',
      cards: [{ code: 'V-BT11/001', qty: 3, name: '天羅水将 ランブロス', rarity: 'VR', section: 'list' }],
    })
    assert.match(res.headers['cache-control'], /s-maxage=300/)
    // It asks Deck Log's own endpoint, the way Deck Log's page does.
    assert.equal(calls[0].url, 'https://decklog.bushiroad.com/system/app/api/view/A7G1')
    assert.equal(calls[0].init.method, 'POST')
    assert.equal(calls[0].init.headers.Referer, 'https://decklog.bushiroad.com/')
  })

  it('reads the code from the URL when the runtime gives no query', async () => {
    upstream(() => answer(DECK))
    const res = await call({ url: '/api/decklog/A7G1?x=1' })
    assert.equal(res.statusCode, 200)
  })

  it('refuses a bad code or method without asking Deck Log', async () => {
    upstream(() => answer(DECK))
    for (const code of ['', 'AB', 'TOOLONGCODE', '../x', 'A7G1/..']) {
      const res = await call({ query: { code } })
      assert.equal(res.statusCode, 400, code)
      assert.equal(res.headers['cache-control'], 'no-store')
    }
    const post = fakeRes()
    await handler({ method: 'POST', query: { code: 'A7G1' } }, post)
    assert.equal(post.statusCode, 405)
    assert.equal(calls.length, 0)
  })

  it('answers 404 for an unknown code (Deck Log’s empty array)', async () => {
    upstream(() => answer([]))
    const res = await call({ query: { code: 'ZZZZ' } })
    assert.equal(res.statusCode, 404)
    assert.deepEqual(res.json(), { error: 'not-found' })
  })

  it('answers 422 for another game’s deck', async () => {
    upstream(() => answer({ ...DECK, game_title_id: 2 }))
    const res = await call({ query: { code: 'A7G1' } })
    assert.equal(res.statusCode, 422)
    assert.deepEqual(res.json(), { error: 'not-vanguard' })
  })

  it('answers 502, uncached, when Deck Log fails, times out or sends junk', async () => {
    const failures = [
      () => answer('oops', 500),
      () => {
        throw new Error('network down')
      },
      () => answer('<html>not json</html>'),
      () => answer('x'.repeat(600 * 1024)),
    ]
    for (const respond of failures) {
      upstream(respond)
      const res = await call({ query: { code: 'A7G1' } })
      assert.equal(res.statusCode, 502)
      assert.equal(res.headers['cache-control'], 'no-store')
    }
  })
})

describe('readJsonCapped', () => {
  it('reads a body under the cap', async () => {
    assert.deepEqual(await readJsonCapped(answer({ a: 1 }), 100), { a: 1 })
  })

  it('stops reading past the cap', async () => {
    await assert.rejects(readJsonCapped(answer({ a: 'x'.repeat(200) }), 100), /over 100 bytes/)
  })
})
