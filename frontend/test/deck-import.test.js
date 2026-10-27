// The deck importer: reading a paste (src/features/deck-import/deckText.js),
// matching it to listings and choosing printings (deckMatch.js), and the
// Deck Log proxy's trimming (api/decklog/[code].js).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_LINE_LENGTH, parseDeckLine, readDeckInput } from '../src/features/deck-import/deckText.js'
import { allocate, buildDeckIndex, planDeck, printingGroup, resolveLine, shortCards } from '../src/features/deck-import/deckMatch.js'
import { trimDeck } from '../api/decklog/[code].js'

describe('readDeckInput', () => {
  it('reads Deck Log links and bare codes', () => {
    assert.deepEqual(readDeckInput('https://decklog.bushiroad.com/view/A7G1'), { kind: 'decklog', code: 'A7G1' })
    assert.deepEqual(readDeckInput('decklog.bushiroad.com/view/a7g1?x=1'), { kind: 'decklog', code: 'A7G1' })
    assert.deepEqual(readDeckInput('  a7g1 '), { kind: 'decklog', code: 'A7G1' })
    assert.deepEqual(readDeckInput('https://decklog-en.bushiroad.com/view/ABC1'), { kind: 'decklog-en' })
    assert.deepEqual(readDeckInput(''), { kind: 'empty' })
  })

  it('reads a decklist, skipping headings and comments', () => {
    const input = readDeckInput('Main deck\n4 D-BT01/001 Blaster Blade\n# note\n\nBlaster Blade x2')
    assert.equal(input.kind, 'text')
    assert.deepEqual(
      input.lines.map(({ qty, code, name }) => [qty, code, name]),
      [
        [4, 'D-BT01/001', 'Blaster Blade'],
        [2, null, 'Blaster Blade'],
      ]
    )
    assert.deepEqual(input.skipped, ['Main deck', '# note'])
  })
})

describe('parseDeckLine', () => {
  const read = (text) => {
    const line = parseDeckLine(text)
    return line && [line.qty, line.code, line.name]
  }

  it('finds the count before or after, in several spellings', () => {
    assert.deepEqual(read('4x D-BT01/001'), [4, 'D-BT01/001', null])
    assert.deepEqual(read('4 x Blaster Blade'), [4, null, 'Blaster Blade'])
    assert.deepEqual(read('x3 Blaster Blade'), [3, null, 'Blaster Blade'])
    assert.deepEqual(read('Blaster Blade ×4'), [4, null, 'Blaster Blade'])
    assert.deepEqual(read('Blaster Blade (x2)'), [2, null, 'Blaster Blade'])
    assert.deepEqual(read('ブラスター・ブレード 4枚'), [4, null, 'ブラスター・ブレード'])
    assert.deepEqual(read('D-BT01/001 Blaster Blade 4'), [4, 'D-BT01/001', 'Blaster Blade'])
    assert.deepEqual(read('4 Blaster Blade (D-BT01/001)'), [4, 'D-BT01/001', 'Blaster Blade'])
  })

  it('keeps an x that starts a name, and digits at the end of one', () => {
    assert.deepEqual(read('4 Xiphos'), [4, null, 'Xiphos'])
    assert.deepEqual(read('2 Max4'), [2, null, 'Max4'])
  })

  it('reads full-width and original-era numbers', () => {
    assert.deepEqual(read('４ Ｄ－ＢＴ０１／００１'), [4, 'D-BT01/001', null])
    assert.deepEqual(read('4 BT13/038 タイダル・アサルト'), [4, 'BT13/038', 'タイダル・アサルト'])
    assert.deepEqual(read('1 V-BT11/SP01'), [1, 'V-BT11/SP01', null])
  })

  it('has no line for text with neither a count nor a number', () => {
    assert.equal(parseDeckLine('Triggers'), null)
    assert.equal(parseDeckLine('   '), null)
  })

  it('reads a bare trailing count only as its own word', () => {
    assert.deepEqual(read('D-BT01/001 Blade4'), [1, 'D-BT01/001', 'Blade4'])
  })

  it('cuts an absurdly long line before matching, quickly', () => {
    const started = Date.now()
    const line = parseDeckLine(`4 ${' -'.repeat(50_000)}x`)
    assert.ok(Date.now() - started < 200)
    assert.ok(line.raw.length <= MAX_LINE_LENGTH)
  })
})

describe('readDeckInput limits', () => {
  it('reads at most MAX_INPUT_LENGTH characters, quickly', () => {
    const started = Date.now()
    const input = readDeckInput(`${'4 Blaster Blade\n'.repeat(5_000)}${' '.repeat(100_000)}x`)
    assert.ok(Date.now() - started < 500)
    assert.equal(input.lines.length, 200)
  })
})

// A small catalog: one card in three printings (two share a number, foil
// and not), and an older-era card of the same English name.
const card = (id, setCode, rarity, nameJp, price, stock, nameEn = 'Blaster Blade') => ({
  id,
  setCode,
  setSlug: id.split('/')[0],
  rarity,
  nameJp,
  nameEn,
  price,
  stock,
})
const CATALOG = [
  card('dbt01/1', 'D-BT01/001', 'RRR', 'ブラスター・ブレード', 500, 1),
  card('dbt01/2', 'D-BT01/001', 'RRR', 'ブラスター・ブレード(箔押し)', 800, 4),
  card('dss01/3', 'D-SS01/010', 'RR', 'ブラスター・ブレード', 200, 2),
  card('dpr/4', 'D-PR/100', 'PR', 'ブラスター・ブレード', 9800, null),
  card('vbt01/5', 'V-BT01/005', 'RRR', 'ブラスター・ブレード', 50, null),
  card('dbt02/6', 'D-BT02/010', 'C', '戦場の歌姫', 30, 0, 'Battlefield Diva'),
]
const index = buildDeckIndex(CATALOG)

describe('resolveLine', () => {
  it('matches a number to its plain printing, and groups every printing of the era', () => {
    const match = resolveLine({ qty: 4, code: 'D-BT01/001', name: null, raw: '' }, index)
    assert.equal(match.listed.id, 'dbt01/1')
    assert.equal(match.via, 'code')
    assert.deepEqual(match.printings.map((c) => c.id).sort(), ['dbt01/1', 'dbt01/2', 'dpr/4', 'dss01/3'])
  })

  it('reads an English printing’s number as the Japanese one', () => {
    assert.equal(resolveLine({ qty: 1, code: 'D-BT01/001EN', name: null, raw: '' }, index).listed.id, 'dbt01/1')
  })

  it('matches names to the newest era, either language', () => {
    assert.equal(resolveLine({ qty: 1, code: null, name: 'blaster blade', raw: '' }, index).listed.setCode.startsWith('D-'), true)
    assert.equal(resolveLine({ qty: 1, code: null, name: 'ブラスター ブレード', raw: '' }, index).via, 'name')
    assert.equal(resolveLine({ qty: 1, code: null, name: 'Nope', raw: '' }, index), null)
  })

  it('groups printings by era and name, ignoring variant markers and spaces', () => {
    assert.equal(printingGroup(CATALOG[1]), printingGroup({ setCode: 'D-SS01/010', nameJp: 'ブラスター ・ブレード' }))
    assert.notEqual(printingGroup(CATALOG[0]), printingGroup(CATALOG[4]))
  })
})

describe('allocate', () => {
  const match = resolveLine({ qty: 4, code: 'D-BT01/001', name: null, raw: '' }, index)
  const ids = ({ take }) => take.map(({ card, qty }) => [card.id, qty])

  it('takes the listed printing in exact mode, short past its stock', () => {
    const result = allocate(4, match, 'exact')
    assert.deepEqual(ids(result), [['dbt01/1', 4]])
    assert.equal(result.short, 3)
  })

  it('fills from the cheapest printings in stock, within the price cap', () => {
    // ¥200 x2, then ¥500 x1, then ¥800 foil x1; the ¥9,800 promo is over 3x.
    const result = allocate(4, match, 'cheapest')
    assert.deepEqual(ids(result), [['dss01/3', 2], ['dbt01/1', 1], ['dbt01/2', 1]])
    assert.equal(result.short, 0)
  })

  it('leaves what it can’t fill on the listed printing', () => {
    const result = allocate(9, match, 'cheapest')
    assert.deepEqual(ids(result), [['dss01/3', 2], ['dbt01/1', 3], ['dbt01/2', 4]])
    assert.equal(result.short, 2)
  })

  it('follows a printing the user picked', () => {
    assert.deepEqual(ids(allocate(4, match, 'cheapest', 'dpr/4')), [['dpr/4', 4]])
  })
})

describe('planDeck', () => {
  const lines = [
    { qty: 2, code: 'D-BT01/001', name: null, raw: 'a' },
    { qty: 1, code: null, name: 'Blaster Blade', raw: 'b' },
    { qty: 4, code: 'D-BT02/010', name: null, raw: 'c' },
    { qty: 1, code: 'X-NO/1', name: 'Nothing', raw: 'd' },
  ]

  it('totals the deck, sharing stock between lines of the same card', () => {
    const plan = planDeck(lines, index, 'cheapest')
    assert.equal(plan.matched, 3)
    // The first line takes both ¥200 copies, so the second moves on to ¥500.
    assert.deepEqual(
      plan.entries.map(({ card, qty }) => [card.id, qty]),
      [
        ['dss01/3', 2],
        ['dbt01/1', 1],
        ['dbt02/6', 4],
      ]
    )
    assert.equal(plan.copies, 7)
    assert.equal(plan.totalJpy, 200 * 2 + 500 + 30 * 4)
    assert.equal(plan.short, 4)
    assert.deepEqual(shortCards(plan).map((c) => c.id), ['dbt02/6'])
  })

  it('counts copies as short once earlier lines have used the stock', () => {
    const twice = [lines[0], { ...lines[0], qty: 1 }]
    const plan = planDeck(twice, index, 'exact')
    // Exact: 2x then 1x of D-BT01/001 (1 in stock) -> 1 + 1 short.
    assert.deepEqual(plan.rows.map((row) => row.short), [1, 1])
  })
})

describe('trimDeck (Deck Log proxy)', () => {
  const data = {
    title: 'Pサヴァス',
    game_title_id: 1,
    list: [{ card_number: 'V-BT11/001', num: 3, name: '天羅水将 ランブロス', rare: 'VR', img: 'x.png' }],
    sub_list: [{ card_number: 'G-BT13/004', num: '2', name: '波濤帥将 アレクサンドロス', rare: 'GR' }],
    p_list: [{ card_number: '', num: 1 }],
  }

  it('keeps only number, count, name, rarity and section', () => {
    assert.deepEqual(trimDeck('A7G1', data), {
      code: 'A7G1',
      title: 'Pサヴァス',
      vanguard: true,
      cards: [
        { code: 'V-BT11/001', qty: 3, name: '天羅水将 ランブロス', rarity: 'VR', section: 'list' },
        { code: 'G-BT13/004', qty: 2, name: '波濤帥将 アレクサンドロス', rarity: 'GR', section: 'sub_list' },
      ],
    })
  })

  it('reads Deck Log’s empty array as no deck, and flags other games', () => {
    assert.equal(trimDeck('ZZZZ', []), null)
    assert.equal(trimDeck('ZZZZ', { ...data, game_title_id: 2 }).vanguard, false)
  })
})
