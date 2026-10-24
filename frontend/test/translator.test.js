// The card modal's rules-text translator (src/features/card/translate):
// plain ESM with no browser APIs, so Node runs it as-is. Its pipeline side
// (the translation memory builder, clans against nation.js) is tested in
// pipeline/test/translator.test.js.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as tr from '../src/features/card/translate/index.js'
import * as terms from '../src/features/card/translate/terms.js'
import * as normalize from '../src/features/card/translate/normalize.js'

// No line memory, so these exercise the grammar itself.
const MEMORY = { lines: {}, fragments: { ブラスター: 'Blaster' } }
const NAMES = () =>
  tr.buildNameIndex([
    { nameJp: 'ブラスター・ブレード', nameEn: 'Blaster Blade', translationSource: 'official' },
    { nameJp: 'ブラスター・ブレード', nameEn: 'Burasutaa Bureedo', translationSource: 'romaji' },
    { nameJp: 'ブラスター・ブレード(箔押し)', nameEn: 'Blaster Blade (Foil Stamping)', translationSource: 'romaji' },
  ])
const translate = (jp, card = { setCode: 'DZ-BT01/001' }) => tr.translateRules(jp, { card, names: NAMES(), memory: MEMORY })

describe('normalizeJp', () => {
  it('folds full-width digits, signs and parentheses to half-width', () => {
    assert.equal(normalize.normalizeJp('【ターン１回】（相手ターンも有効）パワー＋5000'), '【ターン1回】(相手ターンも有効)パワー+5000')
  })

  it('repairs a stat modifier\'s "+" the scrape lost to "?", and nothing else', () => {
    assert.equal(normalize.normalizeJp('クリティカル?１、ドライブ?1'), 'クリティカル+1、ドライブ+1')
    assert.equal(normalize.normalizeJp('ファウスト?世'), 'ファウスト?世')
  })
})

describe('translateTerm', () => {
  it('translates kinds, clans, nations and multi-nation values', () => {
    assert.equal(terms.translateTerm('ノーマルユニット'), 'Normal Unit')
    assert.equal(terms.translateTerm('ロイヤルパラディン'), 'Royal Paladin')
    assert.equal(terms.translateTerm('ドラゴンエンパイア/ストイケイア'), 'Dragon Empire/Stoicheia')
    assert.equal(terms.translateTerm('楽曲/Roselia'), 'Song/Roselia')
    assert.equal(terms.translateTerm('未知の何か'), '未知の何か')
  })
})

describe('translateRules', () => {
  it('reads a D-era ability: header, trigger, cost and action', () => {
    const r = translate('【自】【(V)】：このユニットがアタックした時、【コスト】[【カウンターブラスト】(１)]することで、１枚引く。')
    assert.equal(r.text, '[AUTO](VC):When this unit attacks, [COST][Counter-Blast 1], and draw a card.')
    assert.equal(r.coverage, 1)
  })

  it('puts a G-era cost first and keeps "you may pay the cost"', () => {
    const r = translate('【自】【(V)】【Gブレイク】(1)：[【カウンターブラスト】(1)]このユニットがアタックした時、コストを払ってよい。払ったら、１枚引く。', { setCode: 'G-BT01/001' })
    assert.equal(r.text, '[AUTO](VC)[Generation Break 1]:[COST][Counter-Blast 1] When this unit attacks, you may pay the cost. If you do, draw a card.')
  })

  it('moves a duration to the end of the action it modifies', () => {
    assert.equal(translate('【起】【(V)】：そのターン中、このユニットのパワー＋5000。').text, '[ACT](VC):This unit gets [Power] +5000 until end of turn.')
  })

  it('resolves names: the catalog, the card itself, and fragments', () => {
    assert.equal(translate('【永】【(V)】：あなたのソウルに「ブラスター・ブレード」があるなら、このユニットのパワー＋5000。').text, '[CONT](VC):If your soul has a "Blaster Blade", this unit gets [Power] +5000.')
    assert.equal(
      translate('【自】：このユニットが(R)に登場した時、「騎士王アルフレッド」を１枚まで探し、公開して手札に加える。', { setCode: 'V-BT01/001', nameJp: '騎士王アルフレッド', nameEn: 'King of Knights, Alfred' }).text,
      '[AUTO]:When this unit is placed on (RC), search your deck for up to one "King of Knights, Alfred", and reveal it and put it into hand.'
    )
    assert.equal(translate('【永】【(R)】：あなたのソウルに「ブラスター」を含むカードがあるなら、このユニットのパワー＋5000。').text, '[CONT](RC):If your soul has a card with "Blaster" in its card name, this unit gets [Power] +5000.')
  })

  it('translates clans in 《》', () => {
    assert.equal(translate('【永】【(V)】：あなたの《ロイヤルパラディン》のリアガードすべてのパワー＋2000。', { setCode: 'BT01/001' }).text, '[CONT](VC):All of your <Royal Paladin> rear-guards get [Power] +2000.')
  })

  it('translates a granted ability in 『』 as a quoted ability', () => {
    assert.equal(translate('【起】【(V)】：そのターン中、このユニットは『【自】：このユニットがアタックした時、１枚引く。』を得る。').text, '[ACT](VC):This unit gets "[AUTO]:When this unit attacks, draw a card." until end of turn.')
  })

  it('leaves what it can\'t read in Japanese, flagged, with an unknown name kept as written', () => {
    const r = translate('【自】：このユニットが「謎の何か」を含むカードと謎の儀式をした時、１枚引く。')
    assert.equal(r.text, '[AUTO]:このユニットが「謎の何か」を含むカードと謎の儀式をした時、draw a card.')
    assert.deepEqual(r.segments.filter((s) => s.untranslated).map((s) => s.text), ['このユニットが「謎の何か」を含むカードと謎の儀式をした時、'])
    assert.ok(r.coverage > 0 && r.coverage < 1)
  })

  it('never drops a topic ("Xは、") that no translated clause used', () => {
    assert.equal(translate('【起】【(V)】：あなたと相手は、自分の山札を上から１枚公開する。').text, '[ACT](VC):あなたと相手は、自分の山札を上から1枚公開する。')
    assert.equal(translate('【自】：このユニットは、１枚引く。').text, '[AUTO]:このユニットは、draw a card.')
  })

  it('uses a memory line, refilling its name and numbers', () => {
    const memory = { lines: { '【永】【(V)】:「N」のパワー+#。': '[CONT](VC):"{N}" gets [Power] +{#0}.' }, fragments: {} }
    const r = tr.translateRules('【永】【(V)】：「ブラスター・ブレード」のパワー＋10000。', { card: {}, names: NAMES(), memory })
    assert.equal(r.text, '[CONT](VC):"Blaster Blade" gets [Power] +10000.')
  })
})

describe('translateRules: conditions, lists and house style', () => {
  it('tries later condition rules when an earlier one matches but can\'t read its parts', () => {
    assert.equal(translate('【永】【(R)】：あなたのターン中、あなたの(R)に「ブラスター・ブレード」がいるなら、このユニットのパワー＋10000。').text, '[CONT](RC):During your turn, if you have a "Blaster Blade" on your (RC), this unit gets [Power] +10000.')
  })

  it('reads an or-list of noun phrases, repeating "up to" for each, and translates races in 〈〉', () => {
    assert.equal(
      translate('【自】：このユニットが(V)に登場した時、あなたの山札を上から５枚見て、「ブラスター」を含むカードか〈ハイビースト〉を１枚まで選び、公開して手札に加え、山札をシャッフルする。').text,
      '[AUTO]:When this unit is placed on (VC), look at the top five cards of your deck, choose up to one card with "Blaster" in its card name or up to one <High Beast> from among them, reveal it and put it into hand, and shuffle the deck.'
    )
    assert.equal(translate('【永】【(V)】：あなたのヴァンガードがグレード３以上の〈インセクト〉なら、このユニットのパワー＋5000。（相手ターンも有効）').text, '[CONT](VC):If you have a grade 3 or greater <Insect> vanguard, this unit gets [Power] +5000. (Active on opponent\'s turn too)')
  })

  it('reads clause-level か: "公開したか、…なら", two triggers, two actions', () => {
    assert.equal(
      translate('【自】：このユニットが(R)に登場した時、あなたのライドデッキから「ブラスター」を含むグレード３を１枚選び、公開してよい。公開したか、あなたのヴァンガードが「ブラスター」を含むグレード３以上なら、１枚引く。').text,
      '[AUTO]:When this unit is placed on (RC), choose a grade 3 card with "Blaster" in its card name from your ride deck, and you may reveal it. If you revealed a card, or you have a grade 3 or greater vanguard with "Blaster" in its card name, draw a card.'
    )
    assert.equal(translate('【自】：このユニットが手札から(R)に登場した時か、「ブラスター」を含むあなたのカードの能力で(R)に登場した時、１枚引く。').text, '[AUTO]:When this unit is placed on (RC) from hand or is placed on (RC) by the ability of your card with "Blaster" in its card name, draw a card.')
    assert.equal(translate('【自】【(R)】：このユニットがアタックした時、【コスト】[【カウンターブラスト】(1)]することで、あなたの手札から１枚選び、(R)にコールするか、捨てる。').text, '[AUTO](RC):When this unit attacks, [COST][Counter-Blast 1], choose a card from hand, and call it to (RC) or discard it.')
  })

  it('counts in conditions, and repeats the count for a following "N枚以上なら"', () => {
    assert.equal(
      translate('【永】【(V)】：あなたのターン中、「ブラスター」を含むあなたのユニットが３枚以上なら、このユニットのパワー＋5000。５枚以上なら、さらにクリティカル＋１。').text,
      '[CONT](VC):During your turn, if you have three or more units with "Blaster" in their card names, this unit gets [Power] +5000. If you have five or more units with "Blaster" in their card names, it also gets [Critical] +1.'
    )
  })

  it('lets two unit heads share their modifiers, and leaves "AとBすべて" in Japanese', () => {
    assert.equal(translate('【永】【(R)】：あなたのグレード３の《ロイヤルパラディン》のヴァンガードかリアガードが２枚以上なら、このユニットのパワー＋5000。').text, '[CONT](RC):If you have two or more grade 3 <Royal Paladin> vanguards or rear-guards, this unit gets [Power] +5000.')
    // Is it "all of your A and B" or "your A and all B"? Not guessed.
    assert.ok(translate('【永】【(V)】：あなたの〈戦乙女〉と〈人類〉すべてのパワー＋5000。').coverage < 1)
  })

  it('puts "if it is …" after its action, as the official text does', () => {
    assert.equal(translate('【自】：このユニットが(R)に登場した時、あなたの山札の上を公開し、それがユニットカードなら(R)にコールし、違うなら捨てる。').text, '[AUTO]:When this unit is placed on (RC), reveal the top card of your deck, call it to (RC) if it is a unit card, and discard it if it is not.')
  })

  it('names the act in "コールしたなら", and reads named tokens', () => {
    assert.equal(translate('【起】【(V)】【ターン1回】：【コスト】[【ソウルブラスト】(1)]することで、手札から１枚選び、(R)にコールする。コールしたなら、１枚引く。').text, '[ACT](VC)[1/Turn]:[COST][Soul-Blast 1], choose a card from hand, and call it to (RC). If you called a card, draw a card.')
    assert.equal(translate('【起】【(V)】【ターン1回】：【コスト】[【ソウルブラスト】(1)]することで、プラント・トークンを２枚まで(R)にコールする。').text, '[ACT](VC)[1/Turn]:[COST][Soul-Blast 1], and call up to two Plant tokens to (RC).')
  })

  it('restates the stat in "+5000ではなく+10000" and drops a repeated subject', () => {
    assert.equal(translate('【自】【(R)】：このユニットがアタックした時、そのバトル中、このユニットのパワー＋5000。相手のヴァンガードがグレード３以上なら、＋5000ではなく＋10000。').text, '[AUTO](RC):When this unit attacks, this unit gets [Power] +5000 until end of that battle. If your opponent\'s vanguard is grade 3 or greater, it gets [Power] +10000 instead of +5000.')
    assert.equal(translate('【永】【(R)】：このユニットは『インターセプト』を得て、後列からでもインターセプトできる。').text, '[CONT](RC):This unit gets "Intercept", and can intercept from the back row.')
  })

  it('reads a cost that Soul-Blasts a kind of card', () => {
    assert.equal(translate('【起】【(V)】：【コスト】[「ブラスター」を含むカードを【ソウルブラスト】(1)]することで、１枚引く。').text, '[ACT](VC):[COST][Soul-Blast 1 card with "Blaster" in its card name], and draw a card.')
  })

  it('splits trigger reminders at "!" and keeps the mark', () => {
    assert.equal(
      translate('（トリガーで出たら、あなたのユニットを１枚選び、そのターン中、クリティカル＋１！さらにあなたのユニットを１枚選び、そのターン中、パワー＋10000！）').text,
      '(When revealed as a trigger, choose one of your units, and it gets [Critical] +1 until end of turn! Then, choose one of your units, and it gets [Power] +10000 until end of turn!)'
    )
  })

  it('writes stats the way the card\'s set does: "[Power]+5000" from DZ-BT08 on, memory lines included', () => {
    const jp = '【永】【(R)】：あなたのターン中、このユニットのパワー＋5000。'
    assert.equal(translate(jp, { setCode: 'DZ-BT08/001' }).text, '[CONT](RC):During your turn, this unit gets [Power]+5000.')
    assert.equal(translate(jp, { setCode: 'DZ-BT07/001' }).text, '[CONT](RC):During your turn, this unit gets [Power] +5000.')
    const memory = { lines: { '【永】【(V)】:「N」のパワー+#。': '[CONT](VC):"{N}" gets [Power] +{#0}.' }, fragments: {} }
    assert.equal(tr.translateRules('【永】【(V)】：「ブラスター・ブレード」のパワー＋10000。', { card: { setCode: 'DZ-BT12/001' }, names: NAMES(), memory }).text, '[CONT](VC):"Blaster Blade" gets [Power]+10000.')
    assert.equal(tr.tightStats('DZ-SS16/SEC01'), true)
    assert.equal(tr.tightStats('D-BT13/001'), false)
  })
})

describe('buildNameIndex', () => {
  it('prefers official names and skips foil/signed variants', () => {
    const names = NAMES()
    assert.equal(names.get('ブラスター・ブレード'), 'Blaster Blade')
    assert.equal(names.has('ブラスター・ブレード(箔押し)'), false)
  })
})
