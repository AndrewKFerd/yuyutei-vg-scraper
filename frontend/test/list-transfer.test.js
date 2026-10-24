// The saved lists' transfer formats (src/features/saved-lists/listTransfer.js):
// the link and backup file that move lists between browsers, and how an
// import merges.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as T from '../src/features/saved-lists/listTransfer.js'
import { MAX_LISTS } from '../src/features/saved-lists/savedListsData.js'

const item = (id, over = {}) => ({ id, qty: 1, price: 100, nameEn: `Card ${id}`, nameJp: `カード${id}`, setCode: `DZ-BT01/${id}`, rarity: 'RR', ...over })
const list = (id, over = {}) => ({ id, name: `List ${id}`, createdAt: 1000, updatedAt: 1000, pricedAt: 1000, items: [item('a/1'), item('a/2')], ...over })
const ORIGIN = 'https://yytscrap.online'
const hashOf = (url) => url.slice(url.indexOf('#'))

describe('backup files', () => {
  it('round-trip lists exactly, names and all', () => {
    const lists = [list('x'), list('y', { name: 'デッキ', items: [item('b/9', { qty: 4, price: null, nameEn: null })] })]
    assert.deepEqual(T.readBackupFile(T.backupFileText(lists)).lists, lists)
  })

  it('accept a byte-order mark from an editor', () => {
    assert.equal(T.readBackupFile('\uFEFF' + T.backupFileText([list('x')])).lists.length, 1)
  })

  it('reject what isn’t a backup, with a reason', () => {
    const code = (text) => {
      try {
        T.readBackupFile(text)
      } catch (err) {
        return err.code
      }
      return 'no error'
    }
    assert.equal(code('not json'), 'broken')
    assert.equal(code('{"v":1,"lists":[]}'), 'broken'); // the raw localStorage shape
    assert.equal(code(JSON.stringify({ kind: T.TRANSFER_KIND, v: 2, lists: [] })), 'newer')
    assert.equal(code(JSON.stringify({ kind: T.TRANSFER_KIND, v: 1, lists: [{ id: 'x' }] })), 'empty')
    assert.match(T.transferErrorText('broken', 'file'), /isn’t a saved-lists backup/)
  })

  it('re-check every field, as stored lists are', () => {
    const data = JSON.parse(T.backupFileText([list('x')]))
    data.lists[0].name = '  lots   of\nspace  ' + 'x'.repeat(100)
    data.lists[0].items.push({ id: 'a/1', qty: 5 }, { qty: 2 }, { id: 'c/3', qty: 1000, price: 'free', nameEn: 7 })
    data.lists.push(data.lists[0])
    const [out, ...rest] = T.readPayload(data).lists
    assert.equal(rest.length, 0, 'repeated list ids dropped')
    assert.equal(out.name.length, 60)
    assert.ok(out.name.startsWith('lots of space'))
    assert.deepEqual(out.items.map((i) => i.id), ['a/1', 'a/2', 'c/3'])
    assert.deepEqual(out.items[2], { id: 'c/3', qty: 99, price: null, nameEn: null, nameJp: null, setCode: null, rarity: null })
  })
})

describe('transfer links', () => {
  it('round-trip through the URL fragment, compressed', async () => {
    const lists = [list('x'), list('y', { items: [item('b/9', { qty: 3, price: 5800 })] })]
    const url = await T.transferLink(lists, { origin: ORIGIN })
    assert.match(url, /^https:\/\/yytscrap\.online\/\?view=lists#import=z[A-Za-z0-9_-]+$/)
    assert.ok(T.isTransferHash(hashOf(url)))
    assert.deepEqual((await T.readTransferHash(hashOf(url))).lists, lists)
  })

  it('leave out the names of cards the catalog has, and fill them back in', async () => {
    const catalog = new Map([['a/1', { id: 'a/1', nameEn: 'Fresh name', nameJp: '新しい', setCode: 'DZ-BT01/a1', rarity: 'RRR' }]])
    const withNames = await T.transferLink([list('x')], { origin: ORIGIN })
    const compact = await T.transferLink([list('x')], { origin: ORIGIN, cardsById: catalog })
    assert.ok(compact.length < withNames.length)
    const { lists } = await T.readTransferHash(hashOf(compact))
    assert.ok(T.needsNames(lists))
    assert.equal(lists[0].items[0].nameEn, null)
    // Cards the catalog didn't have kept their saved names.
    assert.equal(lists[0].items[1].nameEn, 'Card a/2')
    const filled = T.fillNames(lists, catalog)
    assert.equal(T.needsNames(filled), false)
    assert.deepEqual(filled[0].items[0], { id: 'a/1', qty: 1, price: 100, nameEn: 'Fresh name', nameJp: '新しい', setCode: 'DZ-BT01/a1', rarity: 'RRR' })
  })

  it('fit a typical list in a QR code', async () => {
    const items = Array.from({ length: 40 }, (_, i) => item(`dzbt14/10${300 + i}`, { qty: (i % 4) + 1, price: 300 + i * 150 }))
    const catalog = new Map(items.map((i) => [i.id, i]))
    const url = await T.transferLink([list('5f0c7a52-6f7e-4d0e-9a4c-2b1f0c1d2e3f', { items })], { origin: ORIGIN, cardsById: catalog })
    assert.ok(url.length < 1000, `${url.length} characters`)
  })

  it('say why a damaged link can’t be read', async () => {
    const url = await T.transferLink([list('x')], { origin: ORIGIN })
    const code = async (hash) => {
      try {
        await T.readTransferHash(hash)
      } catch (err) {
        return err.code
      }
      return 'no error'
    }
    assert.equal(await code(hashOf(url).slice(0, -12)), 'broken'); // cut short in a message
    assert.equal(await code('#import=q' + hashOf(url).slice(9)), 'broken')
    assert.equal(await code('#import=z!!!'), 'broken')
    assert.equal(await code('#card=1'), 'broken')
    const plain = '#import=j' + Buffer.from(JSON.stringify({ kind: T.TRANSFER_KIND, v: 1, lists: [list('x')] })).toString('base64url')
    assert.equal((await T.readTransferHash(plain)).lists.length, 1, 'uncompressed links read too')
  })

  it('stop a link that inflates past the size limit', async () => {
    const huge = new Uint8Array(T.MAX_TRANSFER_BYTES + 1024).fill(32)
    const deflated = Buffer.from(await new Response(new Blob([huge]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
    await assert.rejects(T.readTransferHash('#import=z' + deflated.toString('base64url')), (err) => err.code === 'too-big')
  })
})

describe('importing', () => {
  it('adds new lists, updates older copies, and leaves the rest', () => {
    const local = [list('same'), list('older'), list('newer', { updatedAt: 9000, name: 'Edited here' })]
    const incoming = [
      list('fresh'),
      list('same', { updatedAt: 5000 }), // touched, but nothing the sheet shows changed
      list('older', { updatedAt: 5000, items: [item('a/1', { qty: 3 })] }),
      list('newer', { updatedAt: 5000 }),
    ]
    assert.deepEqual(
      T.planImport(local, incoming).map((p) => p.status),
      ['new', 'same', 'update', 'kept']
    )
    const { lists, counts, firstId } = T.mergeLists(local, incoming)
    assert.deepEqual(lists.map((l) => l.id), ['same', 'older', 'newer', 'fresh'])
    assert.equal(lists[1].items[0].qty, 3)
    assert.equal(lists[2].name, 'Edited here')
    assert.deepEqual(counts, { new: 1, update: 1, same: 1, kept: 1, full: 0 })
    assert.equal(firstId, 'fresh')
    assert.equal(T.importResultText(counts), 'Added 1 list and updated 1 list. 1 was already here, 1 is newer here, so kept.')
  })

  it('stops adding at the list limit', () => {
    const local = Array.from({ length: MAX_LISTS - 1 }, (_, i) => list(`l${i}`))
    const { lists, counts } = T.mergeLists(local, [list('n1'), list('n2'), list('n3')])
    assert.equal(lists.length, MAX_LISTS)
    assert.deepEqual(counts, { new: 1, update: 0, same: 0, kept: 0, full: 2 })
    assert.match(T.importResultText(counts), /^Added 1 list\. 2 didn’t fit \(50 lists at most\)\.$/)
  })

  it('changes nothing when everything is already here', () => {
    const local = [list('x')]
    const { lists, firstId, counts } = T.mergeLists(local, [list('x')])
    assert.equal(firstId, null)
    assert.deepEqual(lists, local)
    assert.equal(T.importResultText(counts), 'Nothing new to import. 1 was already here.')
  })
})
