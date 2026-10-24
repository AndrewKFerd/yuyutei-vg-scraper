// Japanese noun phrases in rules text -> English. A Japanese noun phrase is
// a run of modifiers ending in its head noun ("「X」を含むあなたのグレード3以上の
// ヴァンガード"); the modifiers can come in any order, so they're peeled off
// one at a time into slots that are rendered in English order ("your grade 3
// or greater vanguard with "X" in its card name").
//
// Names (「」), clans (《》) and granted abilities (『』) have already been
// swapped for placeholders by grammar.js (⟦N0⟧, ⟦C0⟧, ⟦A0⟧); `ctx.slot(ph)`
// gives a placeholder's English.

import { ZONES, TOKENS } from './terms.js'

const TOKEN_NAMES = Object.keys(TOKENS).sort((a, b) => b.length - a.length)

export const PH = '⟦[A-Z]\\d+⟧'

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']
export function numberWord(n) {
  const i = Number(n)
  return NUMBER_WORDS[i] || String(n)
}

// Head nouns, longest first so "ノーマルユニット" wins over "ユニット".
// [singular, plural]
const HEADS = Object.entries({
  ノーマルユニット: ['normal unit', 'normal units'],
  トリガーユニット: ['trigger unit', 'trigger units'],
  Gユニット: ['G unit', 'G units'],
  ノーマルオーダー: ['normal order', 'normal orders'],
  セットオーダー: ['set order', 'set orders'],
  ブリッツオーダー: ['blitz order', 'blitz orders'],
  トリガーオーダー: ['trigger order', 'trigger orders'],
  オーダーカード: ['order card', 'order cards'],
  オーダー: ['order', 'orders'],
  リアガード: ['rear-guard', 'rear-guards'],
  ヴァンガード: ['vanguard', 'vanguards'],
  ユニット: ['unit', 'units'],
  カード: ['card', 'cards'],
  守護者: ['sentinel', 'sentinels'],
  トークンユニット: ['token unit', 'token units'],
  トークン: ['token', 'tokens'],
  'Gガーディアン': ['G guardian', 'G guardians'],
  ガーディアン: ['guardian', 'guardians'],
  クリティカルトリガー: ['critical trigger', 'critical triggers'],
  ドロートリガー: ['draw trigger', 'draw triggers'],
  ヒールトリガー: ['heal trigger', 'heal triggers'],
  フロントトリガー: ['front trigger', 'front triggers'],
  スタンドトリガー: ['stand trigger', 'stand triggers'],
  トリガー: ['trigger', 'triggers'],
  ゴーストアイコン: ['ghost icon', 'ghost icons'],
  '【治】': ['[Heal] trigger', '[Heal] triggers'],
  '【前】': ['[Front] trigger', '[Front] triggers'],
  '【引】': ['[Draw] trigger', '[Draw] triggers'],
  '【醒】': ['[Stand] trigger', '[Stand] triggers'],
  '【超】': ['[Over] trigger', '[Over] triggers'],
  '【クリティカル】': ['[Critical] trigger', '[Critical] triggers'],
  ハーツカード: ['heart card', 'heart cards'],
  'クイックシールド・チケット': ['Quick Shield ticket', 'Quick Shield tickets'],
  チケット: ['ticket', 'tickets'],
  作戦: ['Strategy', 'Strategies'],
  アリーナ: ['Arena', 'Arenas'],
  アリーナカード: ['Arena card', 'Arena cards'],
  赫月カード: ['Crimson Moon card', 'Crimson Moon cards'],
  世界カード: ['World card', 'World cards'],
  ユニットカード: ['unit card', 'unit cards'],
  呪縛カード: ['locked card', 'locked cards'],
  ギフトマーカー: ['gift marker', 'gift markers'],
  'ブースト': ['Boost', 'Boost'],
}).sort((a, b) => b[0].length - a[0].length)

// Fixed noun phrases that don't decompose.
const FIXED = {
  このユニット: { en: 'this unit' },
  このカード: { en: 'this card' },
  そのユニット: { en: 'that unit' },
  そのカード: { en: 'that card' },
  そのユニットすべて: { en: 'all of those units', plural: true },
  そのカードすべて: { en: 'all of those cards', plural: true },
  それら: { en: 'them', plural: true },
  それ: { en: 'it' },
  残り: { en: 'the rest', plural: true },
  残りのカード: { en: 'the rest', plural: true },
  あなた: { en: 'you', plural: true },
  相手: { en: 'your opponent' },
  お互い: { en: 'each player' },
  自分: { en: 'themselves' },
  ヴァンガード: { en: 'a vanguard' },
  リアガード: { en: 'a rear-guard' },
  ユニット: { en: 'a unit' },
  '【ブースト】されたユニット': { en: 'the boosted unit' },
  ブーストされたユニット: { en: 'the boosted unit' },
  アタックしているユニット: { en: 'the attacking unit' },
  そのアタックしているユニット: { en: 'that attacking unit' },
  アタックされているユニット: { en: 'the attacked unit' },
  公開されたカード: { en: 'the revealed card' },
  選んだユニット: { en: 'the chosen unit' },
  その登場したユニット: { en: 'that placed unit' },
  そのコールされたユニット: { en: 'that called unit' },
  そのコールしたユニット: { en: 'that called unit' },
  公開された残り: { en: 'the rest of the revealed cards', plural: true },
  その公開されたカード: { en: 'that revealed card' },
}

const POSSESSORS = { あなた: 'your', 相手: "your opponent's", お互い: "each player's", 自分: 'their', いずれか: "any player's" }
const UNIT_HEADS = ['ヴァンガード', 'リアガード', 'ユニット']
const DRESS = { '【オーバードレス】': '[overDress]', '【クロスオーバードレス】': '[XoverDress]', '【ユニゾンドレス】': '[UnisonDress]', '【レヴォルドレス】': '[RevolDress]', '【ドラグドレス】': '[DragDress]' }
const ROWS = { 前列: 'front row', 後列: 'back row', 中央列: 'center column', 左列: 'left column', 右列: 'right column' }

/**
 * Parses a Japanese noun phrase into its parts, or null when some piece
 * isn't understood (the caller then leaves the phrase in Japanese).
 */
export function parseNP(jp) {
  let s = jp.trim()
  if (!s) return null
  const np = { poss: null, other: false, all: false, rows: [], grade: null, clan: null, names: [], named: null, zone: null, faceUp: null, head: null, plural: false, extra: [], suffixes: [] }

  if (/(すべて|全て)$/.test(s)) {
    np.all = true
    np.plural = true
    s = s.replace(/(すべて|全て)$/, '')
  }

  // The head: a known noun, a bare name ("「ブラスター・ブレード」"), a zone,
  // or nothing ("グレード3以上" -> "grade 3 or greater card").
  // A named token: "夜影兵・トークン" -> "Shadow Army token".
  const token = TOKEN_NAMES.find((t) => s.endsWith(`${t}・トークン`) || s.endsWith(`${t}トークン`))
  if (token) {
    np.head = [`${TOKENS[token]} token`, `${TOKENS[token]} tokens`]
    s = s.slice(0, s.lastIndexOf(token))
  }
  const head = !token && HEADS.find(([jpHead]) => s.endsWith(jpHead))
  // Two unit heads sharing the modifiers: "…のヴァンガードかリアガード".
  // ("「X」を含むカードかノーマルオーダー" is two separate things, read by
  // alternatives().)
  const before = head && UNIT_HEADS.includes(head[0]) && HEADS.find(([jpHead]) => UNIT_HEADS.includes(jpHead) && s.slice(0, -head[0].length).endsWith(`${jpHead}か`))
  if (before) {
    np.head = [`${before[1][0]} or ${head[1][0]}`, `${before[1][1]} or ${head[1][1]}`]
    s = s.slice(0, -(head[0].length + before[0].length + 1))
  } else if (head) {
    np.head = head[1]
    s = s.slice(0, -head[0].length)
  } else if (!token) {
    const named = s.match(new RegExp(`(${PH})$`))
    if (named && named[1].startsWith('⟦N')) {
      np.named = named[1]
      s = s.slice(0, -named[1].length)
    } else if (named && named[1].startsWith('⟦C')) {
      np.clanHead = named[1]
      s = s.slice(0, -named[1].length)
    } else {
      const zone = Object.keys(ZONES).sort((a, b) => b.length - a.length).find((z) => s.endsWith(z))
      if (zone) {
        np.head = [ZONES[zone], ZONES[zone]]
        np.isZone = true
        s = s.slice(0, -zone.length)
      }
    }
  }

  while (s) {
    let m
    // Modifiers that start like a possessor ("あなたのヴァンガードと同名の")
    // come first.
    if ((m = s.match(/^(このユニット|このカード|そのユニット|あなたのヴァンガード|それ|そのカード|あなたのユニットいずれか)と(別名|同名)の?/))) {
      const ref = { このユニット: 'this unit', このカード: 'this card', そのユニット: 'that unit', あなたのヴァンガード: 'your vanguard', それ: 'that card', そのカード: 'that card', あなたのユニットいずれか: 'any of your units' }[m[1]]
      np.suffixes.push(m[2] === '別名' ? ` with a different card name from ${ref}` : ` with the same card name as ${ref}`)
    } else if ((m = s.match(/^あなたのヴァンガードのグレード以下の?、?/))) {
      np.suffixes.push(' with grade less than or equal to your vanguard')
    } else if ((m = s.match(/^(あなた|相手|お互い|自分|いずれか)の/))) {
      np.poss = POSSESSORS[m[1]]
    } else if ((m = s.match(/^(あなた|相手)と(あなた|相手)の/))) {
      np.poss = "your and your opponent's"
    } else if ((m = s.match(/^他の/))) {
      np.other = true
    } else if ((m = s.match(/^(前列|後列|中央列|左列|右列)の/))) {
      np.rows.push(ROWS[m[1]])
    } else if ((m = s.match(/^グレード(\d+)(以上|以下)?の?/))) {
      np.grade = `grade ${m[1]}${m[2] === '以上' ? ' or greater' : m[2] === '以下' ? ' or less' : ''}`
    } else if ((m = s.match(new RegExp(`^(⟦C\\d+⟧(?:か⟦C\\d+⟧)*)の`)))) {
      np.clan = m[1].split('か')
    } else if ((m = s.match(new RegExp(`^クランが(⟦C\\d+⟧)のみの`)))) {
      const clan = m[1]
      np.suffixes.push((plural, ctx) => ` with only ${ctx.slot(clan)} for ${plural ? 'their' : 'its'} clan`)
    } else if ((m = s.match(new RegExp(`^(?:カード名に)?(⟦N\\d+⟧(?:か⟦N\\d+⟧)*)を含む`)))) {
      np.names.push(...m[1].split('か'))
    } else if ((m = s.match(/^守護者を持たない/))) {
      np.extra.push('non-sentinel')
    } else if ((m = s.match(/^【レガリスピース】を持たない/))) {
      np.suffixes.push(' without [Regalis Piece]')
    } else if ((m = s.match(new RegExp(`^(⟦A\\d+⟧)を持つ`)))) {
      const ability = m[1]
      np.suffixes.push((plural, ctx) => ` with ${ctx.slot(ability)}`)
    } else if ((m = s.match(/^【(オーバードレス|クロスオーバードレス|ユニゾンドレス|レヴォルドレス|ドラグドレス)】能力を持つ/))) {
      const kw = { オーバードレス: '[overDress]', クロスオーバードレス: '[XoverDress]', ユニゾンドレス: '[UnisonDress]', レヴォルドレス: '[RevolDress]', ドラグドレス: '[DragDress]' }[m[1]]
      np.suffixes.push(` with the ${kw} ability`)
    } else if ((m = s.match(/^その縦列の/))) {
      np.suffixes.push(' in that column')
    } else if ((m = s.match(/^このユニットと同じ縦列の/))) {
      np.suffixes.push(' in the same column as this unit')
    } else if ((m = s.match(/^((?:【[^】]+】状態か)*【[^】]+】状態)の/)) && m[1].match(/【([^】]+)】/g).every((k) => DRESS[k])) {
      // "【オーバードレス】状態か【クロスオーバードレス】状態の" -> "in the [overDress] or [XoverDress] state"
      np.suffixes.push(` in the ${m[1].match(/【[^】]+】/g).map((k) => DRESS[k]).join(' or ')} state`)
    } else if ((m = s.match(/^アタックされている/))) {
      np.attacked = true
    } else if ((m = s.match(/^それぞれ別名の/))) {
      np.suffixes.push(' with different card names')
    } else if ((m = s.match(/^それぞれ異なるグレード(?:の|$)/))) {
      np.suffixes.push(' with different grades')
    } else if ((m = s.match(/^(表|裏)の/))) {
      np.faceUp = m[1] === '表' ? 'face up' : 'face down'
    } else if ((m = s.match(/^(【スタンド】|【レスト】)の/))) {
      np.extra.push(m[1] === '【スタンド】' ? '[Stand]' : '[Rest]')
    } else if ((m = s.match(/^(手札|山札|ソウル|ドロップ|ダメージゾーン|バインドゾーン|オーダーゾーン|Gゾーン|ドロップゾーン)の/))) {
      np.zone = ZONES[m[1]]
    } else if ((m = s.match(/^、/))) {
      // "あなたの、ソウルかドロップから" style comma inside a phrase
    } else {
      return null
    }
    s = s.slice(m[0].length)
  }

  // A bare name only takes "your", "another" or a zone; anything else would
  // be silently dropped by renderNP.
  if (np.named && (np.suffixes.length || np.names.length || np.grade || np.rows.length || np.clan || np.extra.length || np.attacked || np.all)) return null
  if (np.clanHead) np.head = [null, null]
  else if (!np.head && !np.named) np.head = ['card', 'cards']
  return np
}

/** True when the phrase is only a head noun ("リアガード"), with nothing to modify it. */
function bareHead(np) {
  return !np.poss && !np.other && !np.all && !np.rows.length && !np.grade && !np.clan && !np.names.length && !np.zone && !np.faceUp && !np.extra.length && !np.suffixes.length && !np.attacked && !np.named && !np.clanHead
}

/**
 * English for a parsed noun phrase. `count`: null for "the thing itself"
 * (singular unless the phrase says all), a number, or { upTo: n }.
 * `article`: whether a lone singular gets "a"/"an".
 */
export function renderNP(np, ctx, { count = null, article = true } = {}) {
  if (np.named && !np.head) {
    const name = (np.faceUp ? `${np.faceUp} ` : '') + ctx.slot(np.named)
    if (count?.orMore) return { en: `${numberWord(count.orMore)} or more ${name}`, plural: true }
    if (count && (count.upTo || count > 1)) {
      const n = count.upTo ? `up to ${numberWord(count.upTo)}` : numberWord(count)
      return { en: `${n} ${name}`, plural: Number(count.upTo ?? count) !== 1 }
    }
    // One named card is "a "X"" ("choose a "Trickstar" from your drop");
    // the name alone is the card itself ("your vanguard is "X"").
    const lone = np.faceUp || Number(count) === 1 ? aName(name) : name
    if (np.zone) return { en: `${lone} in ${np.poss || 'your'} ${np.zone}`, plural: false }
    if (np.other) return { en: `another ${name}`, plural: false }
    return { en: np.poss ? `${np.poss} ${name}` : lone, plural: false }
  }

  const n = count == null ? null : Number(count.upTo ?? count.orMore ?? count)
  const one = n === 1 && !count?.upTo
  const poss = np.zone ? null : np.poss

  // "one of your rear-guards" counts out of a plural; "a card" doesn't.
  const core = (plural, onePicked = false) => {
    const pre = []
    if (np.other) pre.push('other')
    pre.push(...np.extra)
    if (np.faceUp) pre.push(np.faceUp)
    pre.push(...np.rows)
    if (np.grade) pre.push(np.grade)
    if (np.clan) pre.push(np.clan.map((ph) => ctx.slot(ph)).join(' or '))
    const noun = np.clanHead ? ctx.slot(np.clanHead) : plural ? np.head[1] : np.head[0]
    let text = [...pre, noun].join(' ')
    if (np.names.length) {
      // "one of your rear-guards with "X" in its card name"
      const names = np.names.map((ph) => ctx.slot(ph)).join(' or ')
      text += plural && !onePicked ? ` with ${names} in their card names` : ` with ${names} in its card name`
    }
    if (np.attacked) text += plural ? ' that are being attacked' : ' that is being attacked'
    for (const suffix of np.suffixes) text += typeof suffix === 'function' ? suffix(plural, ctx) : suffix
    if (np.zone) text += ` in ${np.poss || 'your'} ${np.zone}`
    return text
  }

  if (np.all) {
    return { en: poss ? `all of ${poss} ${core(true)}` : `all ${core(true)}`, plural: true }
  }
  if (n != null && count?.orMore) {
    // "one or more token units"
    const qty = `${numberWord(n)} or more`
    return { en: poss ? `${qty} of ${poss} ${core(true)}` : `${qty} ${core(true)}`, plural: true }
  }
  if (n != null) {
    const single = n === 1
    const qty = count.upTo ? `up to ${numberWord(n)}` : single ? 'one' : numberWord(n)
    if (poss) return { en: `${qty} of ${poss} ${core(true, single)}`, plural: !single }
    if (one) {
      const text = core(false)
      return { en: `${indefinite(text)} ${text}`, plural: false }
    }
    return { en: `${qty} ${core(!single)}`, plural: !single }
  }
  const plural = np.plural
  if (poss) return { en: `${poss} ${core(plural)}`, plural }
  if (np.isZone) return { en: `your ${core(false)}`, plural: false }
  const text = core(plural)
  return { en: article && !plural ? `${indefinite(text)} ${text}` : text, plural }
}

/**
 * A counted plural for conditions: "「X」を含むあなたのリアガード" with "three
 * or more" -> { owner: 'your', en: 'three or more rear-guards with "X" in
 * their card names' }. `owner` is the possessor taken off the front (null
 * when the phrase has none, or names a zone: "face up cards in your G zone").
 */
export function countedNP(jp, ctx, qty) {
  const parsed = parseNP(jp.trim())
  if (!parsed || parsed.isZone) return null
  if (parsed.named) return { owner: parsed.zone ? null : parsed.poss, inZone: !!parsed.zone, en: `${qty} ${ctx.slot(parsed.named)}${parsed.zone ? ` in ${parsed.poss || 'your'} ${parsed.zone}` : ''}` }
  parsed.plural = true
  const owner = parsed.zone ? null : parsed.poss
  if (!parsed.zone) parsed.poss = null
  return { owner, inZone: !!parsed.zone, en: `${qty} ${renderNP(parsed, ctx, { count: null, article: false }).en}` }
}

/** 'a "Blaster Blade"' / 'an "Alter Ego Messiah"' / 'a face down "X"'. */
export function aName(en) {
  return `${indefinite(en.replace(/^"/, ''))} ${en}`
}

export function indefinite(word) {
  return /^[aeiou]/i.test(word) && !/^(one|uni|eu)/i.test(word) ? 'an' : 'a'
}

/** Translates a Japanese noun phrase in one step; null when it can't. */
export function np(jp, ctx, opts = {}) {
  const trimmed = jp.trim()
  if (Object.hasOwn(FIXED, trimmed)) return { plural: false, ...FIXED[trimmed] }
  // "【クロスオーバードレス】状態のこのユニット" -> "this unit in the [XoverDress] state"
  const state = /^((?:【[^】]+】状態か)*【[^】]+】状態)の(このユニット|このカード|そのユニット)$/.exec(trimmed)
  if (state && state[1].match(/【[^】]+】/g).every((k) => DRESS[k])) {
    return { en: `${FIXED[state[2]].en} in the ${state[1].match(/【[^】]+】/g).map((k) => DRESS[k]).join(' or ')} state`, plural: false }
  }
  // "あなたのユニット1枚" -> "one of your units".
  const counted = /^(.+?)(\d+)枚$/.exec(trimmed)
  if (counted && opts.count == null) return np(counted[1], ctx, { ...opts, count: Number(counted[2]) })
  const parsed = parseNP(trimmed)
  if (parsed) return renderNP(parsed, ctx, opts)
  // "そのユニットとこのユニット" -> "that unit and this unit". Not when only
  // the second says "all" ("あなたの〈A〉と〈B〉すべて" is all of both).
  const parts = trimmed.split('と')
  if (parts.length === 2 && !(/すべて$/.test(parts[1]) && !/すべて$/.test(parts[0]))) {
    const a = np(parts[0], ctx)
    const b = np(parts[1], ctx)
    if (a && b) return { en: `${a.en} and ${b.en}`, plural: true }
  }
  return alternatives(trimmed, ctx, opts)
}

/**
 * "「X」を含むカードか「Y」" -> "a card with "X" in its card name or "Y"": a
 * count applies to the whole list, so only the first part carries it. The
 * first part must be a whole noun phrase, not a bare clan ("《A》か《B》の
 * リアガード" is one phrase with two clans, read by parseNP).
 */
function alternatives(jp, ctx, opts) {
  const alts = jp.split('か')
  if (alts.length < 2 || !alts.every(Boolean)) return null
  const head = parseNP(alts[0])
  if (head?.clanHead) return null
  const first = head ? renderNP(head, ctx, opts) : Object.hasOwn(FIXED, alts[0]) ? np(alts[0], ctx) : null
  if (!first) return null
  const article = /^an? /.test(first.en)
  // The official text repeats "up to N": "up to one X or up to one "Y"".
  const upTo = opts.count?.upTo
  const rest = alts.slice(1).map((p) => {
    if (Object.hasOwn(FIXED, p)) return FIXED[p].en
    const parsed = parseNP(p)
    // "グレード3のヴァンガードかリアガード": the modifiers may cover both
    // nouns, so a bare noun after か isn't read as its own phrase.
    if (!parsed || (UNIT_HEADS.includes(p) && head && !bareHead(head))) return null
    if (upTo && !parsed.poss) return renderNP(parsed, ctx, { count: { upTo } }).en
    if (first.plural) parsed.plural = true
    return renderNP(parsed, ctx, { count: null, article }).en
  })
  if (rest.includes(null)) return null
  const items = [first.en, ...rest]
  const en = items.length === 2 ? items.join(' or ') : `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`
  return { en, plural: first.plural }
}
