// Japanese rules text -> official-style English, one ability line at a time.
//
//   1. Fixed boilerplate lines (Forerunner, Sentinel, Stride step...) are
//      matched whole.
//   2. The header ("【自】【(V)】【ターン1回】：") is read token by token.
//   3. In the body, bracketed parts are translated first and swapped for
//      placeholders: 「names」 ⟦N⟧, 《clans》 ⟦C⟧, 『granted abilities』 ⟦A⟧,
//      (reminders) ⟦P⟧, [costs] ⟦Q⟧, counted keywords ⟦B⟧.
//   4. Each sentence is cut into clauses at its top-level 、 and every clause
//      gets a role -- a lead-in ("When ...", "if ..."), a duration ("until end
//      of turn"), a subject, or an action -- from the rule tables below.
//   5. The sentence is reassembled in English order: lead-ins, then the
//      actions as one list ("[COST][...], choose ..., and retire it"), with
//      a duration moved to the end of the action it modifies.
//
// A clause no rule understands is kept in Japanese, so the reader can see
// exactly which part wasn't translated.

import { ICONS, CIRCLES, ZONES, HEADER_KEYWORDS, COUNTED, KEYWORDS, STATS, CLANS, RACES, TOKENS } from './terms.js'
import { np, numberWord, parseNP, renderNP, countedNP, aName, indefinite } from './np.js'

const JAPANESE = /[぀-ヿ㐀-鿿]/

// Set `debug.clauses` / `debug.headers` to arrays to collect what the rules
// didn't understand (pipeline/eval-translator.js does).
export const debug = { clauses: null, headers: null }
const generalized = (s) => s.replace(/⟦([A-Z])\d+⟧/g, '⟦$1⟧').replace(/\d+/g, '#')

// ---------------------------------------------------------------------------
// Translation context: the card, the catalog's names, and placeholder slots
// ---------------------------------------------------------------------------

export class Context {
  constructor({ era = null, selfJp = null, selfEn = null, names = null, fragments = null } = {}) {
    this.era = era
    this.selfJp = selfJp
    this.selfEn = selfEn
    this.names = names
    this.fragments = fragments
    this.slots = []
  }

  add(kind, en) {
    this.slots.push(en)
    return `⟦${kind}${this.slots.length - 1}⟧`
  }

  slot(ph) {
    const m = /⟦[A-Z](\d+)⟧/.exec(ph)
    return m ? this.fill(this.slots[Number(m[1])]) : ph
  }

  fill(text) {
    return text.replace(/⟦[A-Z](\d+)⟧/g, (_, i) => this.fill(this.slots[Number(i)]))
  }

  /** English for the text inside 「」, quoted, or the Japanese back when unknown. */
  name(jp, { fragment = false } = {}) {
    let en = null
    if (this.selfJp && jp === this.selfJp && this.selfEn) en = this.selfEn
    else if (!fragment && this.names?.has(jp)) en = this.names.get(jp)
    else if (this.fragments && Object.hasOwn(this.fragments, jp)) en = this.fragments[jp]
    else if (this.names?.has(jp)) en = this.names.get(jp)
    else if (!JAPANESE.test(jp)) en = jp
    return en ? `"${en}"` : `「${jp}」`
  }

  /** "<Royal Paladin>" for the text inside 《》, or the Japanese back. */
  clan(jp) {
    return Object.hasOwn(CLANS, jp) ? `<${CLANS[jp]}>` : `《${jp}》`
  }

  /** "<Prayer Dragon>" for the text inside 〈〉, or the Japanese back. */
  race(jp) {
    if (Object.hasOwn(RACES, jp)) return `<${RACES[jp]}>`
    return JAPANESE.test(jp) ? `〈${jp}〉` : `<${jp}>`
  }
}

// ---------------------------------------------------------------------------
// Bracket-aware splitting
// ---------------------------------------------------------------------------

const OPENERS = '「『(【[⟦《〈'
const CLOSERS = '」』)】]⟧》〉'

/** Splits at any top-level character of `seps`, keeping each piece's separator off. */
function splitTop(text, seps) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (OPENERS.includes(ch)) depth++
    else if (CLOSERS.includes(ch)) depth = Math.max(0, depth - 1)
    if (depth === 0 && seps.includes(ch)) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur) out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

/** Index of the bracket closing the one opened at `start`, or -1. */
function closingIndex(text, start) {
  const open = text[start]
  const close = CLOSERS[OPENERS.indexOf(open)]
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++
    else if (text[i] === close && --depth === 0) return i
  }
  return -1
}

// ---------------------------------------------------------------------------
// Small renderers
// ---------------------------------------------------------------------------

function joinOr(items) {
  if (items.length <= 2) return items.join(' or ')
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`
}

function capitalize(text) {
  return text.replace(/^([("]*)([a-z])/, (_, pre, ch) => pre + ch.toUpperCase())
}

function cards(n) {
  return Number(n) === 1 ? 'a card' : `${numberWord(n)} cards`
}

/** "up to one card" / "up to three cards". */
function upToCards(n) {
  return `up to ${numberWord(n)} card${Number(n) === 1 ? '' : 's'}`
}

/** "(VC)" / "(RC)/(GC)" / "(Back Row RC)" / "(Hand)" for a header place token. */
function placeName(token) {
  return token
    .split('/')
    .map((part) => {
      const row = /^(.+)の\((V|R|G)C?\)$/.exec(part)
      if (row) {
        const rows = { 前列: 'Front Row', 後列: 'Back Row', 中央後列: 'Center Back Row', 左前列: 'Left Front Row', 右前列: 'Right Front Row', 左後列: 'Left Back Row', 右後列: 'Right Back Row', 中央列: 'Center Column', 左列: 'Left Column', 右列: 'Right Column' }
        return rows[row[1]] ? `(${rows[row[1]]} ${row[2]}C)` : null
      }
      if (CIRCLES[part]) return CIRCLES[part]
      if (/^\((VC|RC|GC)\)$/.test(part)) return part
      if (/^(VC|RC|GC)$/.test(part)) return `(${part})`
      if (ZONES[part]) return `(${ZONES[part].replace(/\b\w/g, (c) => c.toUpperCase())})`
      return null
    })
    .reduce((acc, part) => (acc === null || part === null ? null : acc ? `${acc}/${part}` : part), '')
}

/**
 * A source zone the way the official text writes it: "hand" for your own
 * hand, "your drop", "hand, soul, or drop" for a "手札かソウルかドロップ" list,
 * "your opponent's drop".
 */
function zoneList(jp) {
  if (/^その公開された(?:カードの)?中$/.test(jp)) return 'among the revealed cards'
  if (/^その(?:見た)?中$/.test(jp)) return 'among them'
  let s = jp.replace(/^あなたの、?/, '')
  let owner = null
  if (/^(相手|自分)の、?/.test(s)) {
    owner = s.startsWith('相手') ? "your opponent's" : 'their'
    s = s.replace(/^(相手|自分)の、?/, '')
  }
  const parts = s.split('か')
  const zones = parts.map((p) => ZONES[p] || (/^\((VC|RC|GC)\)$/.test(p) ? p : null))
  if (zones.includes(null)) return null
  if (owner) return `${owner} ${joinOr(zones)}`
  if (zones.length > 1) return joinOr(zones)
  return zones[0] === 'hand' ? 'hand' : `your ${zones[0]}`
}

/** A destination zone: "into hand", "into soul", "into drop", "into your damage zone". */
function intoZone(jp) {
  const zone = ZONES[jp]
  return ['hand', 'soul', 'drop'].includes(zone) ? zone : `your ${zone}`
}

// ---------------------------------------------------------------------------
// Fixed lines and reminders
// ---------------------------------------------------------------------------

// Reminder text in parentheses, matched whole (numbers as \d+).
const REMINDERS = [
  [/^相手ターンも有効$/, () => "active on opponent's turn too"],
  [/^この効果は強制$/, () => 'this effect is mandatory'],
  [/^これは(.+?)・?トークンを表すカードであり、デッキには入れられない$/, (token) => (TOKENS[token] ? `this represents ${TOKENS[token].startsWith('"') ? 'a' : indefiniteFor(TOKENS[token])} ${TOKENS[token]} token, and cannot be put in a deck` : null)],
  [/^あなたの\(V\)かGゾーンに表のGユニットが(\d+)枚以上で有効$/, (n) => `active if you have ${numberWord(n)} or more face up G units on your (VC) or in your G zone`],
  [/^あなたのダメージが(\d+)枚以上で有効$/, (n) => `active if you have ${numberWord(n)} or more damage`],
  [/^お互いのヴァンガードがグレード(\d+)以上で解放!$/, (n) => `released when both players' vanguards are grade ${n} or greater!`],
  [/^同じクランのユニットにライドされた時、\(R\)にコールできる$/, () => 'when a unit of the same clan rides this unit, you may call this card to (RC)'],
  [/^共通するクランがないあなたのユニットがいるとアタックできない$/, () => 'if you have a unit that does not share a clan with this unit, this unit cannot attack'],
  [/^守護者はデッキに(\d+)枚までしか入れることができない$/, (n) => `you may only have up to ${numberWord(n)} cards with "Sentinel" in a deck`],
  [/^守護者を持つカードは合計でデッキに(\d+)枚まで入れられる$/, (n) => `you may only have up to a total of ${numberWord(n)} cards with "Sentinel" in a deck`],
  [/^【治】はデッキに(\d+)枚までしか入れることができない$/, (n) => `you may only have up to ${numberWord(n)} [Heal] triggers in a deck`],
  [/^\(R\)にノーマルコールするかわりに、指定ユニットの上に重ねて登場させてもよい$/, () => 'you may place it by stacking it on the specified unit instead of normal calling it to (RC)'],
  [/^あなたのGゾーン(?:の|に)表のGガーディアンが(\d+)枚以下なら使える$/, (n) => `usable if you have ${numberWord(n)} or fewer face up G guardians in your G zone`],
  [/^お互いのヴァンガードがグレード(\d+)以上で、あなたのGゾーン(?:の|に)表のGガーディアンが(\d+)枚以下なら使える$/, (g, n) => `usable if both players' vanguards are grade ${g} or greater, and you have ${numberWord(n)} or fewer face up G guardians in your G zone`],
  [/^相手ヴァンガードがグレード(\d+)以上なら、このユニットは(\d+)度だけドロップゾーンから(\d+)枚山札に戻し、山札から指定カードを探し、双闘できる$/, (g, _once, n) => `if your opponent's vanguard is grade ${g} or greater, this unit can Legion once by returning ${numberWord(n)} cards from your drop to your deck and searching your deck for the specified card`],
  [/^各ターンの指定されたバトルで有効$/, () => 'active in the specified battle of each turn'],
  [/^【治】はデッキに(\d+)枚までしか入れられない$/, (n) => `you may only have up to ${numberWord(n)} [Heal] triggers in a deck`],
  [/^【治】を持つカードは合計でデッキに(\d+)枚まで入れられる$/, (n) => `you may only have up to a total of ${numberWord(n)} cards with [Heal] in a deck`],
  [/^この能力は同名カードを含めて各ターン(\d+)回まで使える$/, (n) => `this ability can be used up to ${numberWord(n)} time${Number(n) === 1 ? '' : 's'} per turn, including cards with the same name`],
]

function reminder(inner) {
  // Body reminders arrive with their circles already converted.
  const s = inner.trim().replace(/。$/, '').replace(/\((VC|RC|GC)\)/g, (_, c) => `(${c[0]})`)
  for (const [re, en] of REMINDERS) {
    const m = re.exec(s)
    const r = m && en(...m.slice(1))
    if (r) return r
  }
  return null
}

// Keywords that sit between the icons and the colon.
const HEADER_LABELS = { 真剣必殺: 'Shinken Hissatsu', 連波: 'Wave', 誉: 'Honor' }

function ordinal(n) {
  const i = Number(n)
  return ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'][i] || `${i}th`
}

// Whole boilerplate lines, tried before any other parsing.
const FIXED_LINES = [
  [/^先駆$/, () => 'Forerunner'],
  [/^守護者$/, () => 'Sentinel'],
  [/^盟主$/, () => 'Lord'],
]

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

/**
 * Reads "【自】【(V)】【ターン1回】【Gブレイク】(2)(...)：" off the front of a
 * line. Returns { en, rest } or null when the line has no ability header.
 */
function parseHeader(line, ctx) {
  let s = line
  let icon = null
  const places = []
  const marks = []
  let prefix = ''

  // A keyword label in front: "過充填-【自】..." / "【ファントムスキル】-【起】...".
  const label = /^([^【:「『(\s、。-]{1,12})-(?=【)/.exec(s)
  if (label) {
    prefix = KEYWORDS[label[1]] || label[1]
    s = s.slice(label[0].length)
  }

  for (;;) {
    let m
    if ((m = /^【([^】]+)】(?:\((\d+)\))?/.exec(s))) {
      const tok = m[1].trim()
      if (ICONS[tok] && !icon) icon = ICONS[tok]
      else if (HEADER_KEYWORDS[tok]) marks.push(HEADER_KEYWORDS[tok](m[2]))
      else if (placeName(tok)) places.push(placeName(tok))
      else if (KEYWORDS[tok] && !icon) prefix = KEYWORDS[tok]
      else return null
      s = s.slice(m[0].length)
    } else if ((m = /^-/.exec(s))) {
      s = s.slice(1)
    } else if (s[0] === '(' && icon) {
      const end = closingIndex(s, 0)
      if (end === -1) return null
      const r = reminder(s.slice(1, end))
      marks.push(`(${r ?? translateBody(s.slice(1, end), ctx).replace(/\.$/, '')})`)
      s = s.slice(end + 1)
    } else if (icon && (m = /^([^【:「『[(、。⟦\s]{1,14}?)(?=-?\d*回目|\(|:)/.exec(s)) && !/[をにがはでと]/.test(m[1])) {
      // A keyword after the icons: "真剣必殺(...):", "連波-2回目以降(...):".
      marks.push(` ${HEADER_LABELS[m[1]] || m[1]}`)
      s = s.slice(m[0].length)
      const nth = /^-?(\d+)回目(以降|のみ)?/.exec(s)
      if (nth) {
        marks.push(`-${ordinal(nth[1])} battle${nth[2] === '以降' ? ' or later' : nth[2] === 'のみ' ? ' only' : ''}`)
        s = s.slice(nth[0].length)
      }
    } else {
      break
    }
  }

  // Older text sometimes has no colon: the cost bracket or the text itself
  // follows the icons directly.
  if (icon && places.length && s[0] !== ':' && (s[0] === '[' || JAPANESE.test(s[0]))) {
    return { en: `${prefix ? `${prefix}-` : ''}${icon}${places.join('')}${marks.join('')}:`, rest: s }
  }
  if (!icon || s[0] !== ':') return null
  const en = `${prefix ? `${prefix}-` : ''}${icon}${places.join('')}${marks.join('')}:`
  return { en, rest: s.slice(1) }
}

// ---------------------------------------------------------------------------
// Bracketed parts -> placeholders
// ---------------------------------------------------------------------------

function protect(text, ctx) {
  let s = text
  // Counted keywords and stat-like tokens: "【カウンターブラスト】(1)".
  s = s.replace(/【([^】]+)】\((\d+)\)/g, (all, tok, n) => {
    if (COUNTED[tok]) return ctx.add('B', `[${COUNTED[tok]} ${n}]`)
    if (HEADER_KEYWORDS[tok]) return ctx.add('B', HEADER_KEYWORDS[tok](n))
    return all
  })
  s = s.replace(/\((V|R|G)\)/g, (_, c) => CIRCLES[`(${c})`])

  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (!'「『(《〈['.includes(ch)) {
      out += ch
      continue
    }
    const end = closingIndex(s, i)
    if (end === -1) {
      out += ch
      continue
    }
    const inner = s.slice(i + 1, end)
    if (ch === '(' && /^(VC|RC|GC|\d+)$/.test(inner)) {
      out += s.slice(i, end + 1)
    } else if (ch === '「') {
      const fragment = s.startsWith('を含む', end + 1) || s.startsWith('を含ま', end + 1)
      out += ctx.add('N', ctx.name(inner, { fragment }))
    } else if (ch === '《') {
      out += ctx.add('C', ctx.clan(inner))
    } else if (ch === '〈') {
      out += ctx.add('C', ctx.race(inner))
    } else if (ch === '『') {
      out += ctx.add('A', `"${translateAbility(inner, ctx)}"`)
    } else if (ch === '(') {
      const r = reminder(inner)
      out += ctx.add('P', `(${r ?? translateBody(inner, ctx).replace(/\.$/, '')})`)
    } else {
      out += ctx.add('Q', translateCost(inner, ctx))
    }
    i = end
  }
  return out
}

// ---------------------------------------------------------------------------
// Costs: [【カウンターブラスト】(1)，手札から１枚捨てる]
// ---------------------------------------------------------------------------

function translateCost(inner, ctx) {
  const body = protect(inner, ctx)
  const st = new Sentence(ctx)
  const items = mergeClauses(splitTop(body, ',、')).map((part) => {
    const solo = /^(⟦B\d+⟧)(?:する|し)?$/.exec(part)
    if (solo) return ctx.slot(solo[1]).replace(/^\[|\]$/g, '')
    const either = /^(⟦B\d+⟧)か(.+)$/.exec(part)
    if (either) {
      const other = st.action(either[2])
      if (other) return `${ctx.slot(either[1]).replace(/^\[|\]$/g, '')} or ${other.replace(/^\[([^\]]+)\]$/, '$1')}`
    }
    const en = st.action(part)
    if (en === null) debug.clauses?.push(generalized(part))
    return en ?? part
  })
  return `[COST][${items.join(' & ')}]`
}

// ---------------------------------------------------------------------------
// Clause rules
// ---------------------------------------------------------------------------

// Verb endings: continuative ("選び"), terminal ("選ぶ"), te-form ("選んで"),
// and "may" ("選んでよい"). `MAY` tells the last one apart.
const MAY = /(?:て|で)よい$/

const STAT_RE = '(?:パワー|クリティカル|シールド|ドライブ|グレード)[+-]\\d+億?'
const STATS_RE = new RegExp(`^(.*?)の?(${STAT_RE}(?:/${STAT_RE})*)(?:し|する|して|してよい)?$`)

function statList(jp) {
  return jp
    .split('/')
    .map((part) => {
      const m = /^(パワー|クリティカル|シールド|ドライブ|グレード)([+-]\d+)(億)?$/.exec(part)
      // "+1億" (an [Over] trigger) -> "+100 Million"
      return `${STATS[m[1]]} ${m[3] ? `${m[2]}00 Million` : m[2]}`
    })
    .join('/')
}

class Sentence {
  constructor(ctx) {
    this.ctx = ctx
    this.leads = []
    this.items = []
    this.until = null
    this.cond = []
    this.subject = null
    this.obj = 'it'
  }

  subj(jp) {
    if (!jp && this.subject) this.topic = null
    if (!jp) return this.subject || (this.obj === 'them' ? { en: 'they', plural: true } : { en: 'it', plural: false })
    // "1枚まで選び、そのユニットは…" after choosing several: "they"
    if (jp === 'そのユニット' && this.obj === 'them') return { en: 'they', plural: true }
    const who = np(jp, this.ctx)
    if (who) this.subject = who
    return who
  }

  /** The object an action names, or the pronoun for the last thing chosen. */
  object(jp) {
    if (!jp) return this.obj
    const r = np(jp, this.ctx)
    if (!r) return null
    this.obj = r.plural ? 'them' : 'it'
    return r.en
  }

  add(en) {
    let text = this.actor === 'opponent' ? thirdPerson(en) : en
    // "… until end of turn for each card in your soul" (official order)
    if (this.until) {
      text += ` ${this.until}`
      this.until = null
    }
    if (this.per) {
      text += ` ${this.per}`
      this.per = null
    }
    // A condition the official text puts after its action ("discard it if it is not").
    if (this.post) {
      text += ` ${this.post}`
      this.post = null
    }
    if (this.cond.length) {
      text = `${this.cond.join(', ')}, ${text}`
      this.cond = []
    }
    this.items.push({ text, raw: false })
  }

  /** A clause nothing understood: kept in Japanese, with its own punctuation. */
  raw(jp) {
    debug.clauses?.push(generalized(jp))
    if (this.cond.length) {
      this.items.push({ text: this.cond.join(', '), raw: false })
      this.cond = []
    }
    // A topic ("あなたと相手は、") nothing used belongs with the clause that failed.
    const text = this.topic ? `${this.topic}、${jp}` : jp
    this.topic = null
    this.items.push({ text, raw: true })
  }

  lead(en) {
    if (this.items.length) this.cond.push(en)
    else this.leads.push(en)
  }

  /** Translates one clause; false when nothing understood it. */
  clause(jp) {
    for (const [re, fn] of CLAUSES) {
      const m = re.exec(jp)
      if (m) {
        const r = fn.call(this, m)
        if (r !== null && r !== undefined) return true
      }
    }
    const en = this.action(jp)
    if (en === null) return false
    this.add(en)
    return true
  }

  /** English for an action clause, or null. */
  action(jp) {
    const may = MAY.test(jp)
    for (const [re, fn] of ACTIONS) {
      const m = re.exec(jp)
      if (!m) continue
      const en = fn.call(this, m)
      if (en) return may && !/^you may /.test(en) ? `you may ${en}` : en
    }
    return null
  }

  render() {
    const items = [...this.items]
    // A topic no clause ended up using is shown rather than dropped.
    if (this.topic) items.unshift({ text: this.topic, raw: true })
    if (this.cond.length) items.push({ text: this.cond.join(', '), raw: false })
    if (this.until) items.push({ text: this.until, raw: false })
    // "this unit gets "Intercept", and can intercept from the back row": the
    // official text drops a subject repeated from the action before.
    for (let i = 1; i < items.length; i++) {
      const s = /^(.+?) (?=(?:gets?|can|cannot) )/.exec(items[i].text)
      if (s && !/,|\bif\b/.test(s[1]) && !items[i].raw && !items[i - 1].raw && items[i - 1].text.startsWith(`${s[1]} `)) items[i] = { ...items[i], text: items[i].text.slice(s[0].length) }
    }
    let text = this.leads.join(', ')
    const english = items.filter((it) => !it.raw).length
    let seen = 0
    items.forEach((it, i) => {
      if (it.raw) {
        if (text && !/[、。]$/.test(text)) text += ', '
        text += it.text + (i === items.length - 1 ? '。' : '、')
        return
      }
      seen++
      if (text && !/[、。]$/.test(text)) text += seen === english && english > 1 && !items[i - 1]?.raw && !/^and /.test(it.text) ? ', and ' : ', '
      text += it.text
    })
    text = this.ctx.fill(text).replace(/\ban other\b/g, 'another')
    // A sentence that is only a reminder ("(Active on opponent's turn too)") takes no period.
    // So does a bare keyword ability ("[CONT]:Sentinel").
    const alone = this.items.length === 1 && !this.items[0].raw && /^(?:\([^()]*\)|(?:Sentinel|Forerunner|Lord)(?: \(.*\))?)$/.test(this.items[0].text) && !this.leads.length
    if (this.end === '!') return capitalize(/。$/.test(text) ? `${text.slice(0, -1)}!` : `${text}!`)
    return capitalize(/。$/.test(text) || alone ? text : `${text}.`)
  }
}

const N = '⟦N\\d+⟧'

const THIRD = { search: 'searches' }
/** "choose one of their rear-guards" -> "chooses one of their rear-guards". */
function thirdPerson(en) {
  return en.replace(/^(you may )?(choose|retire|discard|put|call|draw|reveal|return|bind|shuffle|look|search|turn|perform|ride|imprison|move|remove|heal|lock|pay)\b/, (_, may, verb) => (may ? `may ${verb}` : THIRD[verb] || `${verb}s`))
}

// Lead-ins, durations and subjects.
const CLAUSES = [
  // Trigger reminders: "(トリガーで出たら、…パワー+10000!…)".
  [/^トリガーで出たら$/, function () { return this.lead('when revealed as a trigger') ?? true }],
  [/^ドライブチェックで出たら$/, function () { return this.lead('if revealed during drive check') ?? true }],
  [/^さらに追加効果が発動$/, function () { return this.add('activate its additional effect') ?? true }],
  // Orders: "あなたのヴァンガードが「X」を含むならプレイできる!" -> "Play this if you have …!"
  [/^(.+)ならプレイできる$/, function (m) {
    const c = condition.call(this, m[1])
    if (!c) return null
    this.add(`play this if ${c}`)
    return true
  }],
  [/^相手ターンのガードステップ中$/, function () { return this.lead("during the guard step of your opponent's turn") ?? true }],
  [/^各ターン(?:の)?終了時$/, function () { return this.lead('at the end of each turn') ?? true }],
  [/^(?:(.+?)が)?ブーストされたバトル中$/, function (m) {
    const who = m[1] ? np(m[1], this.ctx) : { en: 'this unit' }
    return who ? this.lead(`during the battle ${who.en} is boosted`) ?? true : null
  }],
  // "このユニットがアタックしたバトルでは" -> "for the battle this unit attacked"
  [/^(?:(.+?)が)?アタックしたバトルでは$/, function (m) {
    const who = m[1] ? np(m[1], this.ctx) : { en: 'this unit' }
    return who ? this.lead(`for the battle ${who.en} attacked`) ?? true : null
  }],
  // "このコストで「X」を含むグレード3以上を【ソウルブラスト】したなら" -> "if a grade 3 or greater card with "X" … was [Soul-Blast] for this cost"
  [/^このコストで(.+?)を(⟦B\d+⟧)したなら$/, function (m) {
    const what = np(m[1], this.ctx)
    return what ? this.lead(`if ${what.en} was ${this.ctx.slot(m[2]).replace(/ \d+\]$/, ']')} for this cost`) ?? true : null
  }],
  [/^そのターン中$/, function () { return (this.until = 'until end of turn') }],
  [/^そのバトル中$/, function () { return (this.until = 'until end of that battle') }],
  [/^次の相手のターン終了時まで$/, function () { return (this.until = "until the end of your opponent's next turn") }],
  [/^このファイト中$/, function () { return (this.until = 'for the rest of the fight') }],
  [/^(あなた|相手)のターン中$/, function (m) { return this.lead(m[1] === 'あなた' ? 'during your turn' : "during your opponent's turn") ?? true }],
  [/^そのバトル終了時$/, function () { return this.lead('at the end of that battle') ?? true }],
  [/^そのターン(?:の)?終了時$/, function () { return this.lead('at the end of that turn') ?? true }],
  [/^(あなた|相手)のターン(?:の)?終了時$/, function (m) { return this.lead(`at the end of ${m[1] === 'あなた' ? 'your' : "your opponent's"} turn`) ?? true }],
  [/^(あなた|相手)の(バトル|ライド|メイン|ドロー|スタンド|エンド)フェイズ(開始|終了)時$/, function (m) {
    const phase = { バトル: 'battle', ライド: 'ride', メイン: 'main', ドロー: 'draw', スタンド: 'stand', エンド: 'end' }[m[2]]
    return this.lead(`at the ${m[3] === '開始' ? 'beginning' : 'end'} of ${m[1] === 'あなた' ? 'your' : "your opponent's"} ${phase} phase`) ?? true
  }],
  [/^(?:(.+?)が)?(?:(.+?)を)?(?:(ヴァンガード|リアガード)に)?(アタック|ブースト|アタックかブースト)したバトル(?:の)?終了時$/, function (m) {
    const s = m[1] ? np(m[1], this.ctx) : { en: 'this unit' }
    const o = m[2] ? np(m[2], this.ctx, { article: true }) : null
    if (!s || (m[2] && !o)) return null
    const target = o ? ` ${o.en}` : m[3] === 'ヴァンガード' ? ' a vanguard' : m[3] === 'リアガード' ? ' a rear-guard' : ''
    const verb = { アタック: 'attacked', ブースト: 'boosted', アタックかブースト: 'attacked or boosted' }[m[4]]
    return this.lead(`at the end of the battle ${s.en} ${verb}${target}`) ?? true
  }],
  // "このユニットが(Xに)ブーストされてアタックしたバトル終了時" -> "at the end of the battle this unit attacked while boosted (by X)"
  [/^(?:(.+?)が)?(?:(.+?)に)?ブーストされ(て|ないで)(?:(ヴァンガード|リアガード|グレード(\d+)以上)に)?アタックしたバトル(?:の)?終了時$/, function (m) {
    const s = m[1] ? np(m[1], this.ctx) : { en: 'this unit' }
    const by = m[2] ? np(m[2], this.ctx) : null
    if (!s || (m[2] && !by)) return null
    const target = m[4] === 'ヴァンガード' ? ' a vanguard' : m[4] === 'リアガード' ? ' a rear-guard' : m[5] ? ` a grade ${m[5]} or greater unit` : ''
    return this.lead(`at the end of the battle ${s.en} attacked${target} while ${m[3] === 'て' ? 'boosted' : 'not boosted'}${by ? ` by ${by.en}` : ''}`) ?? true
  }],
  [/^そのバトルの終了時$/, function () { return this.lead('at the end of that battle') ?? true }],
  [/^そのターンのエンドフェイズ開始時$/, function () { return this.lead('at the beginning of the end phase of that turn') ?? true }],
  [/^(あなた|相手)の(バトル|ライド|メイン|エンド)フェイズ中$/, function (m) {
    const phase = { バトル: 'battle', ライド: 'ride', メイン: 'main', エンド: 'end' }[m[2]]
    return this.lead(`during ${m[1] === 'あなた' ? 'your' : "your opponent's"} ${phase} phase`) ?? true
  }],
  [/^次の相手の(スタンド|ドロー|ライド|メイン|バトル|エンド)フェイズ中$/, function (m) {
    const phase = { スタンド: 'stand', ドロー: 'draw', ライド: 'ride', メイン: 'main', バトル: 'battle', エンド: 'end' }[m[1]]
    return this.lead(`during your opponent's next ${phase} phase`) ?? true
  }],
  [/^相手は手札から\(GC\)にコールする際$/, function () { return this.lead('when your opponent would call cards from hand to (GC)') ?? true }],
  [/^このコストで(退却させた|ソウルに置いた|ソウルに置かれた|バインドした|バインドされた)(ユニット|カード)(\d+)枚につき$/, function (m) {
    const what = `${m[2] === 'ユニット' ? 'unit' : 'card'}${Number(m[3]) === 1 ? '' : 's'}`
    const done = { 退却させた: 'retired', ソウルに置いた: 'put into soul', ソウルに置かれた: 'put into soul', バインドした: 'bound', バインドされた: 'bound' }[m[1]]
    this.per = `for each ${Number(m[3]) === 1 ? '' : `${numberWord(m[3])} `}${what} ${done} for this cost`
    return true
  }],
  [/^相手は(.+)$/, function (m) {
    const saved = this.subject
    this.subject = { en: 'your opponent', plural: false }
    const en = this.action(m[1])
    this.subject = saved
    if (!en) return null
    this.actor = null
    this.add(/^your opponent /.test(en) ? en : `your opponent ${thirdPerson(en)}`)
    this.actor = 'opponent'
    return true
  }],
  [/^あなたは(.+)$/, function (m) {
    const saved = this.subject
    this.subject = { en: 'you', plural: true }
    const en = this.action(m[1])
    this.subject = saved
    if (!en) return null
    this.actor = null
    this.add(en)
    return true
  }],
  // Conditions that continue into the next clause: "…があり、" "…がいなくて、".
  [/^(.+?)(あり|いなくて|なく|いて|含み)$/, function (m) {
    const c = condition.call(this, m[1] + { あり: 'ある', いなくて: 'いない', なく: 'ない', いて: 'いる', 含み: '含む' }[m[2]])
    if (!c) return null
    this.lead(this.and ? `and ${c}` : `if ${c}`)
    this.and = true
    return true
  }],
  [/^(?:山札から)?探した(?:なら|ら)$/, function () { return this.lead('if you searched the deck') ?? true }],
  [/^ライドした(?:なら|ら)$/, function () { return this.lead('if you rode') ?? true }],
  [/^選んだ(?:なら|ら)$/, function () { return this.lead('if you chose a card') ?? true }],
  [/^(公開|ライド|コール|退却さ|捨て)(?:しなかった|せなかった|なかった)(?:なら|ら)$/, function (m) {
    const verb = { 公開: 'reveal a card', ライド: 'ride', コール: 'call a card', 退却さ: 'retire a unit', 捨て: 'discard a card' }[m[1]]
    return verb ? this.lead(`if you did not ${verb}`) ?? true : null
  }],
  [/^(.+?)が(.+?)時か(.+?)時$/, function (m) {
    const a = event.call(this, `${m[1]}が${m[2]}`)
    const b = event.call(this, `${m[1]}が${m[3]}`)
    if (!a || !b) return null
    const subject = np(m[1], this.ctx)?.en
    return this.lead(`when ${a} or ${subject && b.startsWith(`${subject} `) ? b.slice(subject.length + 1) : b}`) ?? true
  }],
  // "…時か、…時": the second trigger leaves out a subject it shares with the first.
  [/^(.+?)時か、(.+)時$/, function (m) {
    const a = event.call(this, m[1])
    if (!a) return null
    const subjectJp = /^(.+?)が/.exec(m[1])?.[1]
    const subject = subjectJp ? np(subjectJp, this.ctx)?.en : /^(this unit|this card) /.exec(a)?.[1]
    let b = event.call(this, m[2])
    if (!b && subject) b = event.call(this, `${subjectJp ?? { 'this unit': 'このユニット', 'this card': 'このカード' }[subject]}が${m[2]}`)
    if (!b) return null
    return this.lead(`when ${a} or ${subject && b.startsWith(`${subject} `) ? b.slice(subject.length + 1) : b}`) ?? true
  }],
  // "公開したか、…なら" -> "if you revealed a card, or …"
  [/^(.+?)か、(.+?)(なら|で|であり)$/, function (m) {
    const a = condition.call(this, m[1])
    const b = a && condition.call(this, m[2])
    if (!b) return null
    this.lead(`${this.and ? 'and' : 'if'} ${a}, or ${b}`)
    this.and = m[3] !== 'なら'
    return true
  }],
  // "それがユニットカードなら(R)にコールし" -> "call it to (RC) if it is a unit card"
  [/^(?:それが|そのカードが)?(.+?)なら(.+)$/, function (m) {
    const what = np(m[1], this.ctx)
    if (!what) return null
    const en = this.action(m[2])
    if (!en) return null
    this.add(`${en} if it is ${what.en}`)
    return true
  }],
  [/^違うなら(.*)$/, function (m) {
    if (!m[1]) return (this.post = 'if it is not')
    const en = this.action(m[1])
    if (!en) return null
    this.add(`${en} if it is not`)
    return true
  }],
  [/^(?:(.+?)が)?アタックする際$/, function (m) {
    const s = m[1] ? np(m[1], this.ctx) : { en: 'this unit' }
    return s ? this.lead(`when ${s.en} would attack`) ?? true : null
  }],
  [/^そのユニットのグレード(\d+)につき$/, function (m) {
    this.per = Number(m[1]) === 1 ? 'for each grade of that unit' : `for every ${numberWord(m[1])} grades of that unit`
    return true
  }],
  // The official text names the act: "公開したなら" -> "If you revealed a card".
  [/^(手札から|手札に|ソウルに)?(置いた|加えた|コールした|公開した|捨てた|引いた|バインドした)(?:なら|ら)$/, function (m) {
    const where = { 手札から: ' from hand', 手札に: ' into hand', ソウルに: ' into soul' }[m[1]] ?? (m[2] === '加えた' ? ' into hand' : '')
    const verb = { 置いた: 'put', 加えた: 'put', コールした: 'called', 公開した: 'revealed', 捨てた: 'discarded', 引いた: 'drew', バインドした: 'bound' }[m[2]]
    return this.lead(`if you ${verb} a card${where}`) ?? true
  }],
  // "2枚コールしたなら" -> "If you called two cards"
  [/^(\d+)枚(以上)?(置いた|加えた|コールした|公開した|捨てた|引いた|バインドした|選んだ|戻した|退却させた)(?:なら|ら)$/, function (m) {
    const verb = { 置いた: 'put', 加えた: 'put', コールした: 'called', 公開した: 'revealed', 捨てた: 'discarded', 引いた: 'drew', バインドした: 'bound', 選んだ: 'chose', 戻した: 'returned', 退却させた: 'retired' }[m[3]]
    const n = Number(m[1])
    const what = m[2] ? `${numberWord(n)} or more cards` : n === 1 ? 'a card' : `${numberWord(n)} cards`
    return this.lead(`if you ${verb} ${what}${m[3] === '加えた' ? ' into hand' : ''}`) ?? true
  }],
  [/^(?:退却させた|ライドした|探した)(?:なら|ら)$/, function () { return this.lead('if you did') ?? true }],
  [/^【双闘(\d*)】(⟦N\d+⟧)(⟦P\d+⟧)?$/, function (m) {
    return this.add(`[Legion${m[1] ? ` ${m[1]}` : ''}] ${this.ctx.slot(m[2])}${m[3] ? ` ${this.ctx.slot(m[3])}` : ''}`) ?? true
  }],
  [/^さらに$/, function () { return this.lead('then') ?? true }],
  [/^さらに(.+)$/, function (m) {
    // "3枚以上なら、さらにパワー+5000" -> "if …, it also gets [Power] +5000"
    if (!this.items.length && !this.leads.length) this.lead('then')
    else this.also = true
    const ok = this.clause(m[1])
    this.also = false
    return ok ? true : null
  }],
  [/^(あなたの|相手の)?(ソウル|ドロップ|ダメージゾーン|バインドゾーン|手札)(?:の(?:カード)?)?(\d+)枚につき$/, function (m) {
    const n = Number(m[3])
    const zone = `${m[1] === '相手の' ? "your opponent's" : 'your'} ${ZONES[m[2]]}`
    this.per = `for each ${n === 1 ? 'card' : `${numberWord(n)} cards`} in ${zone}`
    return true
  }],
  // "あなたのリアガード1枚につき" -> "for each of your rear-guards"
  [/^(.+?)(\d+)枚につき$/, function (m) {
    const parsed = parseNP(m[1])
    if (!parsed || parsed.named || parsed.isZone) return null
    const n = Number(m[2])
    // "あなたのGゾーンの表のカード1枚につき" -> "for each face up card in your G zone"
    if (parsed.zone) {
      if (n !== 1) return null
      this.per = `for each ${renderNP(parsed, this.ctx, { article: false }).en}`
      return true
    }
    const poss = parsed.poss
    parsed.poss = null
    parsed.plural = true
    const many = renderNP(parsed, this.ctx, { article: false }).en
    parsed.plural = false
    const one = renderNP(parsed, this.ctx, { article: false }).en
    this.per = n === 1 ? (poss ? `for each of ${poss} ${many}` : `for each ${one}`) : `for every ${numberWord(n)} ${poss ? `of ${poss} ` : ''}${many}`
    return true
  }],
  [/^(?:(.+?)が)?(アタック|ブースト|【ブースト】)したバトル中$/, function (m) {
    const s = m[1] ? np(m[1], this.ctx) : { en: 'this unit' }
    if (!s) return null
    return this.lead(`during the battle ${s.en} ${m[2] === 'アタック' ? 'attacked' : 'boosted'}`) ?? true
  }],
  [/^その後$/, function () { return this.lead('then') ?? true }],
  [/^(?:払ったら|そうしたら|そうしたなら)$/, function () { return this.lead('if you do') ?? true }],
  [/^【コスト】(⟦Q\d+⟧)(?:する)?ことで$/, function (m) { return this.add(this.ctx.slot(m[1])) ?? true }],
  [/^(.+)時$/, function (m) {
    const ev = event.call(this, m[1])
    return ev ? this.lead(`when ${ev}`) ?? true : null
  }],
  [/^(.+?)(?:で|であり)$/, function (m) {
    const c = condition.call(this, m[1])
    if (!c) return null
    this.lead(`if ${c}`)
    this.and = true
    return true
  }],
  [/^(.+)なら$/, function (m) {
    const c = condition.call(this, m[1])
    if (!c) return null
    this.lead(this.and ? `and ${c}` : `if ${c}`)
    this.and = false
    return true
  }],
  [/^(.+)は$/, function (m) {
    const s = np(m[1], this.ctx)
    if (!s) return null
    this.subject = s
    // Kept until a clause uses it, so it can't vanish when none does.
    this.topic = m[0]
    return true
  }],
]

/**
 * Tries a table of [regex, fn] rules in order. A rule whose regex matches
 * but whose parts aren't understood returns null, and the next rule gets a
 * try (so a broad early pattern doesn't hide a better later one).
 */
function firstRule(rules, jp, self) {
  for (const [re, fn] of rules) {
    const m = re.exec(jp)
    if (!m) continue
    const r = fn.call(self, m)
    if (r) return r
  }
  return null
}

/** "by your vanguard's ability", but "by the ability of your vanguard with "X" in its card name". */
function byAbility(owner) {
  return /\bwith\b|\bin (?:its|their|your)\b|"/.test(owner) ? `by the ability of ${owner}` : `by ${owner}'s ability`
}

/** A boost or attack target with no head noun is a unit: "a grade 3 or greater unit with "X" in its card name". */
function unitTarget(jp, en) {
  return /カード$/.test(jp) ? en : en.replace(/\bcard\b/, 'unit')
}

/** A bare name as something you have: 'a "Blaster Blade"'. */
function indefiniteName(en) {
  return /^"/.test(en) ? aName(en) : en
}

/** "you have <X>": "your vanguard with …" -> "a vanguard with …", "your units" stays. */
function haveNP(en) {
  if (!/^your /.test(en)) return indefiniteName(en)
  const rest = en.slice(5)
  return /^"/.test(rest) ? aName(rest) : `${indefiniteFor(rest)} ${rest}`
}

// "X時" -- what triggers an [AUTO] ability.
function event(jp) {
  return firstRule(EVENTS, jp, this)
}

const PHASES = { ターン: 'turn', ライドフェイズ: 'ride phase', メインフェイズ: 'main phase', バトルフェイズ: 'battle phase', エンドフェイズ: 'end phase' }

const EVENTS = [
  [/^(あなた|相手)の(ターン|ライドフェイズ|メインフェイズ|バトルフェイズ|エンドフェイズ)に(.+)$/, function (m) {
    const ev = event.call(this, m[3])
    return ev ? `${ev} during ${m[1] === 'あなた' ? 'your' : "your opponent's"} ${PHASES[m[2]]}` : null
  }],
  [/^バトルフェイズ以外に(.+)$/, function (m) {
    const ev = event.call(this, m[1])
    return ev ? `${ev} outside of the battle phase` : null
  }],
  [/^手札から捨てられた$/, () => 'this card is discarded from hand'],
  // "あなたのヴァンガードの能力のコストで同時に【ソウルブラスト】(4)以上した" ->
  // "you [Soul-Blast 4] or more cards at the same time for the cost of your vanguard's ability"
  [/^(.+?)の能力のコストで同時に(⟦B\d+⟧)以上した$/, function (m) {
    const owner = np(m[1], this.ctx)
    return owner ? `you ${this.ctx.slot(m[2])} or more cards at the same time for the cost of ${byAbility(owner.en).replace(/^by /, '')}` : null
  }],
  [/^このカードがドレス元になった$/, () => 'this card becomes an originalDress'],
  [/^(.+?)が(カードの能力|カードの効果|ユニットカードの能力以外|(.+?)の能力)で(.+)$/, function (m) {
    const by = m[2] === 'カードの能力' ? 'by a card\'s ability' : m[2] === 'カードの効果' ? 'by a card\'s effect' : m[2] === 'ユニットカードの能力以外' ? 'other than by a unit card\'s ability' : null
    const owner = m[3] ? np(m[3], this.ctx) : null
    const ev = event.call(this, `${m[1]}が${m[4]}`)
    if (!ev || (!by && !owner)) return null
    return `${ev} ${by || byAbility(owner.en)}`
  }],
  [/^あなたが(.+?)をプレイした$/, function (m) {
    const what = np(m[1], this.ctx)
    return what ? `you play ${what.en}` : null
  }],
  [/^あなたのドライブチェックで(.+?)が出た$/, function (m) {
    const what = np(m[1], this.ctx)
    return what ? `${what.en} is revealed in your drive check` : null
  }],
  // "このユニットがアタックかブーストしたアタックがヴァンガードにヒットした" ->
  // "this unit's attack or the attack it boosted hits a vanguard"
  [/^(.+?)がアタックかブーストしたアタックが(ヴァンガード|リアガード)?(?:に)?ヒットした$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en}'s attack or the attack it boosted hits${m[2] ? ` a ${m[2] === 'ヴァンガード' ? 'vanguard' : 'rear-guard'}` : ''}` : null
  }],
  [/^(.+?)がブーストしたアタックが(ヴァンガード|リアガード)?(?:に)?ヒットした$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `the attack ${who.en} boosted hits${m[2] ? ` a ${m[2] === 'ヴァンガード' ? 'vanguard' : 'rear-guard'}` : ''}` : null
  }],
  [/^(.+?)が(.+?)からライドして(\((?:VC)\))に登場した$/, function (m) {
    const who = np(m[1], this.ctx)
    const from = np(m[2], this.ctx)
    return who && from ? `${who.en} is placed on (VC) by riding from ${from.en}` : null
  }],
  [/^(.+?)が(.+?)にアタックした$/, function (m) {
    if (/^(ヴァンガード|リアガード|グレード\d+以上)$/.test(m[2])) return null
    const who = np(m[1], this.ctx)
    const whom = np(m[2], this.ctx)
    return who && whom ? `${who.en} attacks ${unitTarget(m[2], whom.en)}` : null
  }],
  [/^登場$/, () => 'this unit is placed'],
  // "このユニットがトークンユニットのいる(R)に登場した" -> "this unit is placed on a (RC) with a token unit"
  [/^(.+?)が(.+?)のいる\(RC\)に登場した$/, function (m) {
    const who = np(m[1], this.ctx)
    const what = np(m[2], this.ctx)
    if (!who || !what) return null
    return what.en === 'this unit' ? `${who.en} is placed on the (RC) this unit is on` : `${who.en} is placed on a (RC) with ${what.en}`
  }],
  [/^(?:(.+?)が)?(?:((?:手札|ドロップ|ソウル|山札|ドロップゾーン)(?:か(?:手札|ドロップ|ソウル|山札|ドロップゾーン))*)から)?(\((?:VC|RC|GC)\)(?:か\((?:VC|RC|GC)\))?)?に?登場した$/, function (m) {
    if (!m[1] && !m[2] && !m[3]) return null
    const who = m[1] ? np(m[1], this.ctx) : { en: 'this unit' }
    if (!who) return null
    // "from deck or hand"
    const from = m[2] ? ` from ${joinOr(m[2].split('か').map((z) => ZONES[z]))}` : ''
    if (!m[3]) return `${who.en} is placed${from}`
    return `${who.en} is placed on ${m[3].replace('か', ' or ')}${from}`
  }],
  [/^(?:(.+?)が)?(?:(ヴァンガード|リアガード|グレード(\d+)以上)に)?アタックした$/, function (m) {
    const who = m[1] ? np(m[1], this.ctx) : { en: 'this unit' }
    if (!who) return null
    const target = m[2] === 'ヴァンガード' ? ' a vanguard' : m[2] === 'リアガード' ? ' a rear-guard' : m[3] ? ` a grade ${m[3]} or greater unit` : ''
    return `${who.en} ${who.plural ? 'attack' : 'attacks'}${target}`
  }],
  [/^(.+?)が(.+?)を(?:【ブースト】|ブースト)した$/, function (m) {
    const who = np(m[1], this.ctx)
    const whom = np(m[2], this.ctx)
    return who && whom ? `${who.en} boosts ${unitTarget(m[2], whom.en)}` : null
  }],
  [/^(?:(.+?)が)?(アタックか)?(?:【ブースト】|ブースト)(された|した)$/, function (m) {
    const who = m[1] ? np(m[1], this.ctx) : { en: 'this unit' }
    if (!who) return null
    if (m[2]) return `${who.en} attacks or boosts`
    return `${who.en} ${m[3] === 'された' ? 'is boosted' : 'boosts'}`
  }],
  [/^(?:(.+?)の)?アタックが(ヴァンガード|リアガード)?(?:に)?ヒットした$/, function (m) {
    const who = m[1] ? np(m[1], this.ctx) : null
    if (m[1] && !who) return null
    const target = m[2] === 'ヴァンガード' ? ' a vanguard' : m[2] === 'リアガード' ? ' a rear-guard' : ''
    return `${who ? `${who.en}'s attack` : 'the attack'} hits${target}`
  }],
  [/^(?:(.+?)が)?(?:(.+?)に)?ライドされた$/, function (m) {
    const who = m[1] ? np(m[1], this.ctx) : { en: 'this unit' }
    const by = m[2] ? np(m[2], this.ctx) : null
    if (!who || (m[2] && !by)) return null
    return `${who.en} is rode upon${by ? ` by ${by.en}` : ''}`
  }],
  [/^(.+?)が\((VC|RC|GC)\)から(手札|山札)に戻された$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} is returned to ${m[3] === '手札' ? 'hand' : 'the deck'} from (${m[2]})` : null
  }],
  [/^(.+?)が\((VC|RC|GC)\)から(ドロップゾーン|ドロップ|ソウル|ダメージゾーン|バインドゾーン)に置かれた$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} is put into ${intoZone(m[3])} from (${m[2]})` : null
  }],
  [/^(.+?)が\((VC|RC|GC)\)から退却した$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} is retired from (${m[2]})` : null
  }],
  [/^(.+?)が【超越】した$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} ${who.plural ? 'Stride' : 'Strides'}` : null
  }],
  [/^(.+?)が(このユニット|このカード)にライドした$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} rides ${m[2] === 'このユニット' ? 'this unit' : 'this card'}` : null
  }],
  [/^(.+?)が(.+?)からライドして登場した$/, function (m) {
    const who = np(m[1], this.ctx)
    const from = np(m[2], this.ctx)
    return who && from ? `${who.en} is placed by riding from ${from.en}` : null
  }],
  [/^(?:(.+?)が)?(?:インターセプト|【インターセプト】)した$/, function (m) {
    const who = m[1] ? np(m[1], this.ctx) : { en: 'this unit' }
    return who ? `${who.en} intercepts` : null
  }],
  [/^(.+?)を手札から捨てた$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `you discard ${who.en} from hand` : null
  }],
  [/^(.+?)が(手札から)?\((VC|RC|GC)\)に置かれた$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} is put on (${m[3]})${m[2] ? ' from hand' : ''}` : null
  }],
  [/^(.+?)が(?:手札から)?(ソウル|ドロップ|ドロップゾーン|ダメージゾーン|バインドゾーン|オーダーゾーン)に置かれた$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} ${who.plural ? 'are' : 'is'} put into ${intoZone(m[2])}` : null
  }],
  [/^(.+?)が退却した$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} ${who.plural ? 'are' : 'is'} retired` : null
  }],
  [/^(?:(.+?)が)?(?:(.+?)に)?ブーストされ(て|ないで)(?:(ヴァンガード|リアガード|グレード(\d+)以上)に)?アタックした$/, function (m) {
    const who = m[1] ? np(m[1], this.ctx) : { en: 'this unit' }
    const by = m[2] ? np(m[2], this.ctx) : null
    if (!who || (m[2] && !by)) return null
    const target = m[4] === 'ヴァンガード' ? ' a vanguard' : m[4] === 'リアガード' ? ' a rear-guard' : m[5] ? ` a grade ${m[5]} or greater unit` : ''
    return `${who.en} attacks${target} while ${m[3] === 'て' ? 'boosted' : 'not boosted'}${by ? ` by ${by.en}` : ''}`
  }],
  [/^(.+?)が(.+?)に(?:ブースト|【ブースト】)された$/, function (m) {
    const who = np(m[1], this.ctx)
    const by = np(m[2], this.ctx)
    return who && by ? `${who.en} is boosted by ${by.en}` : null
  }],
  [/^(.+?)がアタックされた$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} ${who.plural ? 'are' : 'is'} attacked` : null
  }],
  // "このユニットが…の能力で【スタンド】した" -> "this unit [Stand] by …'s ability"
  [/^(.+?)が【スタンド】した$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} [Stand]` : null
  }],
  [/^(.+?)が\((VC|RC|GC)\)からバインドされた$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} is bound from (${m[2]})` : null
  }],
  [/^(.+?)が山札から捨てられた$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} is discarded from deck` : null
  }],
  [/^(?:(.+?)の)?アタックがヒットしなかった$/, function (m) {
    const who = m[1] ? np(m[1], this.ctx) : null
    if (m[1] && !who) return null
    return `${who ? `${who.en}'s attack` : 'the attack'} does not hit`
  }],
  [/^(.+?)が\((VC|RC|GC)\)か\((VC|RC|GC)\)から退却した$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} is retired from (${m[2]}) or (${m[3]})` : null
  }],
  [/^(.+?)が手札から捨てられた$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} is discarded from hand` : null
  }],
]

// "Xなら" -- an "if" condition.
function condition(jp) {
  return firstRule(CONDITIONS, jp, this)
}

const orMore = (n, dir) => (dir ? `${numberWord(n)} or ${dir === '以上' ? 'more' : 'fewer'}` : numberWord(n))
const gradeRange = (dir) => (dir === '以上' ? ' or greater' : dir === '以下' ? ' or less' : '')

const CONDITIONS = [
  [/^公開した$/, () => 'you revealed a card'],
  [/^あなたのダメージゾーンの枚数が相手のダメージゾーンの枚数以上$/, () => "the number of cards in your damage zone is equal to or more than your opponent's"],
  [/^(?:それ|そのカード)が(.+)$/, function (m) {
    const what = np(m[1], this.ctx)
    return what ? `it is ${what.en}` : null
  }],
  [/^あなたが(先攻|後攻)$/, (m) => `you went ${m[1] === '先攻' ? 'first' : 'second'}`],
  [/^このターンにあなたが(.+?)をプレイしている$/, function (m) {
    const what = np(m[1], this.ctx)
    return what ? `you played ${what.en} this turn` : null
  }],
  [/^このファイトであなたがグレード(\d+)以上にライドしていない$/, (m) => `you have not ridden a grade ${m[1]} or greater unit this fight`],
  [/^このターン(\d+)回目(以降)?のバトル$/, (m) => `it is the ${ordinal(m[1])} battle${m[2] ? ' or later' : ''} of this turn`],
  [/^あなたの監獄に収容されている相手のカードが(\d+)枚以上$/, function (m) {
    this.ctx.lastCount = (q) => `${q} are imprisoned`
    return `${numberWord(m[1])} or more of your opponent's cards are imprisoned in your Prison`
  }],
  [/^あなたの表のダメージゾーンがない$/, () => 'you have no face up cards in your damage zone'],
  [/^(.+?)すべてが(このユニット|このカード)と別名$/, function (m) {
    const who = np(`${m[1]}すべて`, this.ctx)
    return who ? `${who.en} have different card names from ${m[2] === 'このユニット' ? 'this unit' : 'this card'}` : null
  }],
  // "あなたのヴァンガードのクランが《ジェネシス》のみ" -> "you have a vanguard with only <Genesis> for its clan"
  [/^あなたのヴァンガード(?:のクランが(⟦C\d+⟧)のみ|が(⟦C\d+⟧)のみに属する)$/, function (m) { return `you have a vanguard with only ${this.ctx.slot(m[1] || m[2])} for its clan` }],
  [/^あなたのヴァンガード(?:のクランがいずれかのクランのみ|がいずれかのクランのみに属する)$/, () => 'you have a vanguard with only one clan'],
  [/^このユニットと同じ縦列にあなたの他のユニットがいる$/, () => 'you have another unit in the same column as this unit'],
  // "あなたの後列にグレード1以下のリアガードが2枚以上" -> "you have two or more grade 1 or less rear-guards in your back row"
  [/^(あなたの|相手の)(前列|後列)に(.+?)が(\d+)枚(以上|以下)?$/, function (m) {
    const what = countedNP(m[3], this.ctx, orMore(m[4], m[5]))
    if (!what || what.owner || what.inZone) return null
    return `${m[1] === '相手の' ? 'your opponent has' : 'you have'} ${what.en} in ${m[1] === '相手の' ? 'their' : 'your'} ${m[2] === '前列' ? 'front' : 'back'} row`
  }],
  [/^(.+?)がパワー(\d+)以上$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en}'s power is ${m[2]} or greater` : null
  }],
  [/^このターンにあなたがペルソナライドしている$/, () => 'you persona rode this turn'],
  // "あなたのヴァンガードが「X」を含むグレード3以上" / "…が〈インセクト〉" ->
  // "you have a grade 3 or greater vanguard with "X" in its card name" / "a <Insect> vanguard"
  [/^(あなた|相手)のヴァンガードが(.+)$/, function (m) {
    const pred = parseNP(m[2])
    if (!pred) return null
    if (pred.clanHead && !pred.poss) {
      pred.clan = [pred.clanHead]
      pred.clanHead = null
    } else if (!pred.head || pred.head[0] !== 'card' || !pred.names.length) return null
    pred.head = ['vanguard', 'vanguards']
    const what = renderNP(pred, this.ctx)
    return `${m[1] === 'あなた' ? 'you have' : 'your opponent has'} ${what.en}`
  }],
  [/^あなたが(⟦N\d+⟧)のクレストを持つ$/, function (m) {
    const name = this.ctx.slot(m[1])
    return `you have ${indefiniteFor(name.replace(/^"/, ''))} ${name} crest`
  }],
  // "このターンに相手のリアガードが退却している" -> "your opponent's rear-guard was retired this turn"
  [/^このターンに(.+?)が(?:(カードの能力|カードの効果|(.+?)の能力)で)?(退却|登場|呪縛され|【スタンド】|(ソウル|ドロップ|オーダーゾーン|バインドゾーン|ダメージゾーン)に置かれ)している$/, function (m) {
    const who = np(m[1], this.ctx)
    if (!who) return null
    const owner = m[3] ? np(m[3], this.ctx) : null
    if (m[3] && !owner) return null
    const by = m[2] === 'カードの能力' ? " by a card's ability" : m[2] === 'カードの効果' ? " by a card's effect" : owner ? ` ${byAbility(owner.en)}` : ''
    if (m[4] === '【スタンド】') return `${who.en} [Stand]${by} this turn`
    const done = m[5] ? `put into ${m[5] === 'オーダーゾーン' ? 'the order zone' : intoZone(m[5])}` : { 退却: 'retired', 登場: 'placed', 呪縛され: 'locked' }[m[4]]
    return `${who.en} ${who.plural ? 'were' : 'was'} ${done}${by} this turn`
  }],
  [/^(あなたの|相手の)(前列|後列)に(.+?)がいない$/, function (m) {
    const what = np(`${m[3]}すべて`, this.ctx)
    if (!what || !/^all /.test(what.en)) return null
    return `${m[1] === '相手の' ? "your opponent's" : 'your'} ${m[2] === '前列' ? 'front' : 'back'} row has no ${what.en.replace(/^all /, '')}`
  }],
  // "5枚以上なら" after a count: the same count again ("if you have five or more").
  [/^(\d+)枚(以上|以下)?$/, function (m) {
    return this.ctx.lastCount ? this.ctx.lastCount(orMore(m[1], m[2])) : null
  }],
  [new RegExp(`^(.+?)が(${N}(?:か${N})*)を含む$`), function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} has ${m[2].split('か').map((ph) => this.ctx.slot(ph)).join(' or ')} in its card name` : null
  }],
  [/^(.+?)がグレード(\d+)(以上|以下)?$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} is grade ${m[2]}${gradeRange(m[3])}` : null
  }],
  // "相手のヴァンガードのグレードが3以上" -> "your opponent's vanguard is grade 3 or greater"
  [/^(.+?)のグレードが(\d+)(以上|以下)?$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} is grade ${m[2]}${gradeRange(m[3])}` : null
  }],
  [/^(.+?)が(ヴァンガード|リアガード)$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} is a ${m[2] === 'ヴァンガード' ? 'vanguard' : 'rear-guard'}` : null
  }],
  [new RegExp(`^(.+?)が(${N})$`), function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} is ${this.ctx.slot(m[2])}` : null
  }],
  [/^(あなた|相手)の(.+?)がいる$/, function (m) {
    const what = np(m[2], this.ctx, { count: null })
    if (!what) return null
    return `${m[1] === 'あなた' ? 'you have' : 'your opponent has'} ${what.en}`
  }],
  [/^(.+?)の(.+?)がいる$/, function (m) {
    if (!/^(⟦C\d+⟧|.*を含む)/.test(m[1])) return null
    const what = np(`${m[1]}の${m[2]}`, this.ctx)
    return what ? `you have ${haveNP(what.en)}` : null
  }],
  [/^(.+?)がいる$/, function (m) {
    const what = np(m[1], this.ctx)
    if (!what) return null
    return /^your /.test(what.en) ? `you have ${haveNP(what.en)}` : `there is ${what.en}`
  }],
  // "それと同名があなたのオーダーゾーンにある" -> "your order zone has a card with the same card name as that card"
  [/^(.+?)が(あなたの|相手の)(ソウル|ドロップ|ドロップゾーン|ダメージゾーン|バインドゾーン|オーダーゾーン|手札|Gゾーン)にある$/, function (m) {
    const what = np(m[1], this.ctx)
    return what ? `${m[2] === '相手の' ? "your opponent's" : 'your'} ${ZONES[m[3]]} has ${indefiniteName(what.en)}` : null
  }],
  [/^(あなたの|相手の)?(ソウル|ドロップ|ドロップゾーン|ダメージゾーン|バインドゾーン|オーダーゾーン|手札|山札|Gゾーン)に(.+?)がある$/, function (m) {
    const what = np(m[3], this.ctx)
    if (!what) return null
    return `${m[1] === '相手の' ? "your opponent's" : 'your'} ${ZONES[m[2]]} has ${indefiniteName(what.en)}`
  }],
  [/^(あなたの|相手の)?(ソウル|ドロップ|ドロップゾーン|ダメージゾーン|バインドゾーン|オーダーゾーン|手札|山札|ダメージ)(?:のカード)?が(\d+)枚(以上|以下)?$/, function (m) {
    const zone = m[2] === 'ダメージ' ? 'damage zone' : ZONES[m[2]]
    const owner = m[1] === '相手の' ? "your opponent's" : 'your'
    this.ctx.lastCount = (q) => `${owner} ${zone} has ${q} cards`
    return `${owner} ${zone} has ${m[4] ? orMore(m[3], m[4]) : `exactly ${numberWord(m[3])}`} cards`
  }],
  [/^(あなたの|相手の)?(表|裏)の(ソウル|ドロップ|ダメージゾーン|バインドゾーン|オーダーゾーン|Gゾーン)が(\d+)枚(以上|以下)?$/, function (m) {
    const frame = (q) => `${m[1] === '相手の' ? "your opponent's" : 'your'} ${ZONES[m[3]]} has ${q} ${m[2] === '表' ? 'face up' : 'face down'} cards`
    this.ctx.lastCount = frame
    return frame(orMore(m[4], m[5]))
  }],
  // "あなたのオーダーゾーンにセットオーダーが2枚以上" -> "your order zone has two or more set orders"
  // "…にアリーナが2種類以上" -> "your order zone has two or more different Arenas"
  [/^(あなたの|相手の)?(ソウル|ドロップ|ドロップゾーン|ダメージゾーン|バインドゾーン|オーダーゾーン|手札|山札|Gゾーン)に(.+?)が(\d+)(枚|種類)(以上|以下)?$/, function (m) {
    const kinds = m[5] === '種類' ? ' different' : ''
    const frame = (q) => {
      const what = countedNP(m[3], this.ctx, q + kinds)
      return what && !what.owner && !what.inZone ? `${m[1] === '相手の' ? "your opponent's" : 'your'} ${ZONES[m[2]]} has ${what.en}` : null
    }
    const en = frame(orMore(m[4], m[6]))
    if (en) this.ctx.lastCount = frame
    return en
  }],
  // "あなたのソウルが8種類以上" -> "your soul has eight or more cards with different card names"
  [/^(あなたの|相手の)?(ソウル|ドロップ|ドロップゾーン|ダメージゾーン|バインドゾーン|オーダーゾーン|手札)が(\d+)種類(以上|以下)?$/, function (m) {
    const frame = (q) => `${m[1] === '相手の' ? "your opponent's" : 'your'} ${ZONES[m[2]]} has ${q} cards with different card names`
    this.ctx.lastCount = frame
    return frame(orMore(m[3], m[4]))
  }],
  // "「X」を含むあなたのリアガードが3枚以上" -> "you have three or more rear-guards with "X" in their card names"
  [/^(.+?)が(\d+)枚(以上|以下)?$/, function (m) {
    const frame = (q) => {
      const what = countedNP(m[1], this.ctx, q)
      if (!what) return null
      if (what.owner === 'your' || (what.inZone && !what.owner)) return `you have ${what.en}`
      if (what.owner === "your opponent's") return `your opponent has ${what.en}`
      return null
    }
    const en = frame(orMore(m[2], m[3]))
    if (en) this.ctx.lastCount = frame
    return en
  }],
  [/^(あなたの|相手の)?(\((?:VC|RC|GC)\))に(.+?)がいる$/, function (m) {
    const what = np(m[3], this.ctx)
    if (!what) return null
    if (/^(this|that) /.test(what.en)) return `${what.en} is on ${m[2]}`
    return `${m[1] === '相手の' ? 'your opponent has' : 'you have'} ${indefiniteName(what.en)} on ${m[1] === '相手の' ? 'their' : 'your'} ${m[2]}`
  }],
  [/^(.+?)が(\((?:VC|RC|GC)\))にいる$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} is on ${m[2]}` : null
  }],
  [/^グレード(\d+)(以上|以下)?$/, (m) => `it is grade ${m[1]}${gradeRange(m[2])}`],
  [/^(.+?)がいない$/, function (m) {
    const what = np(m[1], this.ctx)
    if (!what || !/^your /.test(what.en)) return null
    const rest = what.en.replace(/^your /, '')
    return `you do not have ${indefiniteFor(rest)} ${rest}`
  }],
  [/^(.+?)のパワーが(\d+)以上$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en}'s power is ${m[2]} or greater` : null
  }],
  [/^(あなた|相手)の(.+?)がいない$/, function (m) {
    const what = np(m[2], this.ctx)
    if (!what) return null
    return `${m[1] === 'あなた' ? 'you do not have' : 'your opponent does not have'} ${what.en.replace(/^an? /, 'a ').replace(/^a (?=[aeiou])/i, 'an ')}`
  }],
  [/^このターンにあなたが(⟦B\d+⟧|【[^】]+】)していない$/, function (m) {
    const what = m[1].startsWith('⟦') ? this.ctx.slot(m[1]) : (KEYWORDS[m[1].slice(1, -1)] || `[${COUNTED[m[1].slice(1, -1)] || m[1]}]`)
    return `you did not ${what} this turn`
  }],
  // "このユニットが【クロスオーバードレス】状態" -> "this unit is in the [XoverDress] state"
  [/^(.+?)が【(オーバードレス|クロスオーバードレス|ユニゾンドレス|レヴォルドレス|ドラグドレス)】状態$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} is in the ${KEYWORDS[m[2]]} state` : null
  }],
  [/^このターンに(.+?)が(カードの能力|カードの効果)で【スタンド】していない$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} did not [Stand] by ${m[2] === 'カードの能力' ? "a card's ability" : "a card's effect"} this turn` : null
  }],
  [/^(.+?)が【双闘】している$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} is [Legion]` : null
  }],
  // "あなたの「X」を含むハーツカードがある" -> "you have a heart card with "X" in its card name"
  [/^(あなた|相手)の(.+?)がある$/, function (m) {
    const what = np(m[2], this.ctx)
    if (!what || /^(your|this|that)\b/.test(what.en)) return null
    return `${m[1] === 'あなた' ? 'you have' : 'your opponent has'} ${indefiniteName(what.en)}`
  }],
  [/^その(?:ターン|バトル)で(\d+)回目(以降)?のバトル中$/, (m) => `it is the ${ordinal(m[1])} battle${m[2] ? ' or later' : ''} of this turn`],
  [/^(?:あなたの)?リアガードが相手(?:のリアガード)?より多い$/, () => 'you have more rear-guards than your opponent'],
  [/^(.+?)が【(スタンド|レスト)】している$/, function (m) {
    const who = np(m[1], this.ctx)
    return who ? `${who.en} is [${m[2] === 'スタンド' ? 'Stand' : 'Rest'}]` : null
  }],
]

function indefiniteFor(word) {
  return indefinite(word)
}

// "(source から)(X を)(N 枚(まで|以上))" in front of a verb.
const OBJ = '(?:(.+?)から)?(?:(.+?)を)?(?:(\\d+)枚(まで|以上)?)?'
const objRe = (verb) => new RegExp(`^${OBJ}${verb}$`)

/**
 * The English object (and " from <zone>") of an OBJ match, or null when
 * part of it isn't understood. With no object named, the pronoun for the
 * last thing chosen.
 */
function objectOf(st, m) {
  const [src, x, n, upTo] = [m[1], m[2], m[3], m[4]]
  let from = ''
  if (src) {
    const z = zoneList(src)
    if (!z) return null
    from = ` from ${z}`
  }
  if (!x && !n) return { en: st.obj, from }
  const count = n ? (upTo === 'まで' ? { upTo: Number(n) } : upTo === '以上' ? { orMore: Number(n) } : Number(n)) : null
  const what = x ? np(x, st.ctx, { count }) : { en: upTo === 'まで' ? upToCards(n) : upTo === '以上' ? `${numberWord(n)} or more cards` : cards(n), plural: upTo === '以上' || Number(n) !== 1 }
  if (!what) return null
  st.obj = what.plural ? 'them' : 'it'
  return { en: what.en, from }
}

// Actions. Each returns English, or null to let a later rule try.
const KEYWORD_LINES = { 先駆: 'Forerunner', 守護者: 'Sentinel', 盟主: 'Lord' }

const CALL_CIRCLE = '(?:別々の|ユニットのいない|(?:中央|左|右)?(?:後列|前列)の)?\\((?:VC|RC|GC)\\)'

/** "(RC)" / "an open (RC)" (one card) / "open (RC)" (several) / "back row (RC)". */
function circleName(jp, plural) {
  return jp
    .replace('別々の', 'separate ')
    .replace('ユニットのいない', plural ? 'open ' : 'an open ')
    // "to a back row (RC)" for one card
    .replace(/^(中央|左|右)?(後列|前列)の/, (_, side, row) => `${plural ? '' : 'a '}${{ 中央: 'center ', 左: 'left ', 右: 'right ' }[side] || ''}${row === '後列' ? 'back row' : 'front row'} `)
}

const ACTIONS = [
  // "(R)にコールするか、捨てる" -> "call it to (RC) or discard it"
  [/^(.+?)か、(.+)$/, function (m) {
    const a = this.action(m[1])
    const b = a && this.action(m[2])
    return b ? `${a} or ${b.replace(/^you may /, '')}` : null
  }],
  [/^(⟦[PA]\d+⟧)$/, function (m) { return this.ctx.slot(m[1]) }],
  [/^(先駆|守護者|盟主)(⟦P\d+⟧)?$/, function (m) { return `${KEYWORD_LINES[m[1]]}${m[2] ? ` ${this.ctx.slot(m[2])}` : ''}` }],
  [/^【超越】(⟦P\d+⟧)?-ストライドステップ-(?:【コスト】)?(⟦Q\d+⟧)(?:ことで)?(.*)$/, function (m) {
    const rest = m[3] ? this.action(m[3]) : null
    if (m[3] && !rest) return null
    return `[Stride]${m[1] ? ` ${this.ctx.slot(m[1])}` : ''}-Stride Step-${this.ctx.slot(m[2])}${rest ? ` ${rest}` : ''}`
  }],
  [/^【Gガーディアン】(⟦P\d+⟧)?-相手ターンのガードステップ-(?:【コスト】)?(⟦Q\d+⟧)(?:ことで)?(.*)$/, function (m) {
    const rest = m[3] ? this.action(m[3]) : null
    if (m[3] && !rest) return null
    return `[G guardian]${m[1] ? ` ${this.ctx.slot(m[1])}` : ''}-Guard Step of your opponent's turn-${this.ctx.slot(m[2])}${rest ? ` ${rest}` : ''}`
  }],
  [/^裏のこのカードを\(VC\)に【超越】する$/, () => 'Stride this face down card on (VC)'],
  [/^裏のこのカードを\(GC\)にコールする$/, () => 'call this face down card to (GC)'],
  [/^【コスト】(⟦Q\d+⟧)(?:する)?ことでプレイできる!?$/, function (m) { return `play this with ${this.ctx.slot(m[1])}` }],
  [/^(?:(.+?)を)?回復する$/, function (m) {
    const what = this.object(m[1])
    return what === null ? null : `heal ${what}`
  }],
  [/^(?:あなたの)?手札からグレード(?:の合計|が合計)が?(\d+)以上になるように(\d+)枚以上(?:選び|選ぶ)?$/, function (m) {
    this.obj = 'them'
    return `choose ${numberWord(m[2])} or more cards with a total grade of ${m[1]} or greater from hand`
  }],
  // "+5000ではなく+10000" -> "it gets [Power] +10000 instead of +5000" (the stat named last)
  [/^([+-]\d+)ではなく([+-]\d+)$/, function (m) {
    const they = this.items.length ? this.obj === 'them' : this.ctx.lastStatPlural
    return `${they ? 'they get' : 'it gets'} ${this.ctx.lastStat || '[Power]'} ${m[2]} instead of ${m[1]}`
  }],
  [/^(?:(.+?)を)?表に(?:する|し|して)$/, function (m) {
    const what = this.object(m[1])
    return what === null ? null : `turn ${what} face up`
  }],
  [/^(?:あなたの)?山札(?:を|の)上から(\d+)枚まで見(?:て|る)$/, function (m) {
    this.looked = true
    return `look at up to ${numberWord(m[1])} cards from the top of your deck`
  }],
  [/^(?:あなたの)?山札(?:を|の)上から(\d+)枚公開(?:し|する|して)$/, function (m) {
    this.obj = Number(m[1]) === 1 ? 'it' : 'them'
    return Number(m[1]) === 1 ? 'reveal the top card of your deck' : `reveal the top ${numberWord(m[1])} cards of your deck`
  }],
  [/^(?:残り(?:のカード)?(?:すべて)?)を山札の(上|下)に(?:好きな|望む)順(?:番)?で置(?:く|き)$/, (m) => `put the rest on the ${m[1] === '上' ? 'top' : 'bottom'} of the deck in any order`],
  [/^(?:(.+?)を)?【(スタンド|レスト)】でライド(?:し|する|してよい)$/, function (m) {
    const what = this.object(m[1])
    return what === null ? null : `ride ${what} as [${m[2] === 'スタンド' ? 'Stand' : 'Rest'}]`
  }],
  [/^(.+?)を(\d+)枚(まで)?公開して手札に加え(?:る|て)?$/, function (m) {
    const what = np(m[1], this.ctx, { count: m[3] ? { upTo: Number(m[2]) } : Number(m[2]) })
    if (!what) return null
    this.obj = what.plural ? 'them' : 'it'
    return `reveal ${what.en} and put ${this.obj} into hand`
  }],
  [/^(?:(.+?)から)?(.+?)を(\d+)枚(まで)?探(?:し|す)$/, function (m) {
    const what = np(m[2], this.ctx, { count: m[4] ? { upTo: Number(m[3]) } : Number(m[3]) })
    if (!what) return null
    let from = 'your deck'
    if (m[1]) {
      const z = zoneList(m[1])
      if (!z) return null
      from = z.startsWith('your') ? z : `your ${z}`
    }
    this.obj = what.plural ? 'them' : 'it'
    return `search ${from} for ${what.en}`
  }],
  [/^(?:(.+?)を)?(\d+)枚を?手札に加え(?:る|て)?$/, function (m) {
    const what = m[1] ? np(m[1], this.ctx, { count: Number(m[2]) }) : { en: cards(m[2]), plural: Number(m[2]) > 1 }
    if (!what) return null
    return `put ${what.en} into hand`
  }],
  [/^この能力は使えなくなる$/, () => 'this ability can no longer be used'],
  [/^(?:(.+?)を)?あなたの監獄に収容(?:する|し|して)$/, function (m) {
    const what = this.object(m[1])
    return what === null ? null : `imprison ${what} in your Prison`
  }],
  [/^(?:(.+?)を)?山札の上かソウルに置(?:く|き)$/, function (m) {
    const what = this.object(m[1])
    return what === null ? null : `put ${what} on the top of the deck or into soul`
  }],
  [/^(?:あなたの)?山札(?:を|の)上から(\d+)枚捨て(?:る|て)?$/, (m) => `discard the top ${Number(m[1]) === 1 ? 'card' : `${numberWord(m[1])} cards`} of your deck`],
  [/^(?:(.+?)は)?後列からでもインターセプトできる$/, function (m) {
    const who = this.subj(m[1])
    return who ? `${who.en} can intercept from the back row` : null
  }],
  // "1枚まで選んで公開し" -> "choose up to one card from among them and reveal it"
  [/^(.+?選)んで公開(?:し|する|して)$/, function (m) {
    const choose = this.action(`${m[1]}び`)
    return choose && /^choose /.test(choose) ? `${choose} and reveal ${this.obj}` : null
  }],
  // "山札からセットオーダーを1枚まで探して公開し" -> "search your deck for up to one set order and reveal it"
  [/^(.+?探)して公開(?:し|する)$/, function (m) {
    const search = this.action(`${m[1]}し`)
    return search && /^search /.test(search) ? `${search} and reveal ${this.obj}` : null
  }],
  [/^山札に戻してシャッフル(?:し|する)$/, function () { return `return ${this.obj} to the deck and shuffle it` }],
  [/^(?:(.+?)は)?(次の)?スタンドフェイズに【スタンド】でき(?:ない|ず)$/, function (m) {
    const who = this.subj(m[1])
    return who ? `${who.en} cannot [Stand] during the ${m[2] ? 'next ' : ''}stand phase` : null
  }],
  [/^(?:(.+?)は)?(アタック|ブースト|インターセプト|ガード)できず$/, function (m) {
    const who = this.subj(m[1])
    return who ? `${who.en} cannot ${{ アタック: 'attack', ブースト: 'boost', インターセプト: 'intercept', ガード: 'guard' }[m[2]]}` : null
  }],
  [/^(?:(.+?)は)?(アタック|ブースト|インターセプト|ガード)できない$/, function (m) {
    const who = this.subj(m[1])
    return who ? `${who.en} cannot ${{ アタック: 'attack', ブースト: 'boost', インターセプト: 'intercept', ガード: 'guard' }[m[2]]}` : null
  }],
  [/^(?:(.+?)から)?(.+?)を(\d+)枚(まで)?除外(?:する|し|して)$/, function (m) {
    const what = np(m[2], this.ctx, { count: m[4] ? { upTo: Number(m[3]) } : Number(m[3]) })
    if (!what) return null
    const from = m[1] ? zoneList(m[1]) : null
    if (m[1] && !from) return null
    this.obj = what.plural ? 'them' : 'it'
    return `remove ${what.en}${from ? ` from ${from}` : ''}`
  }],
  [/^(?:(.+?)を)?除外(?:する|し|して)$/, function (m) {
    const what = this.object(m[1])
    return what === null ? null : `remove ${what}`
  }],
  [/^(⟦B\d+⟧)(?:する|し|して|してよい)?$/, function (m) { return this.ctx.slot(m[1]) }],
  // "「X」を含むカードを【ソウルブラスト】(1)" -> "Soul-Blast 1 card with "X" in its card name"
  [/^(.+?)を(⟦B\d+⟧)(?:する|し|して)?$/, function (m) {
    const kw = this.ctx.slot(m[2]).replace(/^\[|\]$/g, '')
    const n = Number(/(\d+)$/.exec(kw)?.[1] ?? 1)
    const parsed = parseNP(m[1])
    if (!parsed || parsed.named || parsed.poss || parsed.isZone) return null
    parsed.plural = n > 1
    return `${kw} ${renderNP(parsed, this.ctx, { count: null, article: false }).en}`
  }],
  [/^(⟦Q\d+⟧)(?:する|し)?ことで$/, function (m) { return this.ctx.slot(m[1]) }],
  [/^(\d+)枚引(?:く|き|いて|いてよい)$/, (m) => `draw ${cards(m[1])}`],
  [/^(あなたの|その)?山札をシャッフル(?:する|し|して)$/, () => 'shuffle the deck'],
  [/^(あなたの|自分の)?山札(?:を|の)上から(\d+)枚見(?:て|る|てよい)$/, function (m) {
    this.looked = true
    // "相手は自分の山札を上から3枚見て" -> "your opponent looks at the top three cards of their deck"
    const deck = m[1] === '自分の' ? 'their deck' : 'your deck'
    return Number(m[2]) === 1 ? `look at the top card of ${deck}` : `look at the top ${numberWord(m[2])} cards of ${deck}`
  }],
  // choose
  [/^(?:(.+?)から)?(?:(.+?)を)?(\d+)枚(まで)?選(?:び|ぶ|んで)$/, function (m) {
    const count = m[4] ? { upTo: Number(m[3]) } : Number(m[3])
    let what
    if (m[2]) {
      what = np(m[2], this.ctx, { count })
      if (!what) return null
    } else {
      what = { en: m[4] ? upToCards(m[3]) : cards(m[3]), plural: Number(m[3]) > 1 }
    }
    let from = ''
    if (m[1]) {
      const z = zoneList(m[1])
      if (!z) return null
      from = ` from ${z}`
    } else if (this.looked) {
      from = ' from among them'
      this.looked = false
    }
    this.obj = what.plural || (count.upTo && count.upTo > 1) ? 'them' : 'it'
    return `choose ${what.en}${from}`
  }],
  // call
  [/^(?:(.+?)を)?このユニットと同じ縦列の\(RC\)にコール(?:し|する|して|してよい)$/, function (m) {
    const what = this.object(m[1])
    return what === null ? null : `call ${what} to the (RC) in the same column as this unit`
  }],
  // "ドロップから「X」を1枚まで(R)にコールする", "プラント・トークンを2枚まで(R)にコールする"
  [new RegExp(`^${OBJ}(${CALL_CIRCLE})に(?:【(スタンド|レスト)】で)?コール(?:し|する|して|してよい)$`), function (m) {
    const o = objectOf(this, m)
    return o && `call ${o.en}${o.from} to ${circleName(m[5], this.obj === 'them')}${m[6] ? ` as [${m[6] === 'スタンド' ? 'Stand' : 'Rest'}]` : ''}`
  }],
  [new RegExp(`^(?:(.+?)を)?(?:(.+?)から)?(${CALL_CIRCLE})に(?:【(スタンド|レスト)】で)?コール(?:し|する|して|してよい)$`), function (m) {
    const what = this.object(m[1])
    if (what === null) return null
    const from = m[2] ? zoneList(m[2]) : null
    if (m[2] && !from) return null
    return `call ${what}${from ? ` from ${from}` : ''} to ${circleName(m[3], what === 'them' || /s$/.test(what))}${m[4] ? ` as [${m[4] === 'スタンド' ? 'Stand' : 'Rest'}]` : ''}`
  }],
  [/^公開して手札に加え(?:る|て)?$/, function () { return `reveal ${this.obj} and put ${this.obj} into hand` }],
  [/^(?:(.+?)を)?手札に加え(?:る|て|てよい)?$/, function (m) {
    const what = this.object(m[1])
    return what === null ? null : `put ${what} into hand`
  }],
  [/^(?:(?:あなたの)?手札を)(\d+)枚捨て(?:る|て|てよい)?$/, (m) => `discard ${cards(m[1])} from hand`],
  [/^(?:あなたの)?山札(?:を|の)上から(\d+)枚(?:を)?(ダメージゾーン|ソウル|ドロップ|ドロップゾーン)に置(?:く|き|いて)$/, (m) => `put the top ${Number(m[1]) === 1 ? 'card' : `${numberWord(m[1])} cards`} of your deck into ${intoZone(m[2])}`],
  [objRe('公開(?:し|する|して|してよい)'), function (m) {
    const o = objectOf(this, m)
    return o && `reveal ${o.en}${o.from}`
  }],
  [objRe('相手に見せ(?:る|て)?'), function (m) {
    const o = objectOf(this, m)
    return o && `reveal ${o.en}${o.from} to your opponent`
  }],
  [new RegExp(`^${OBJ}(手札|山札)に戻(?:す|し|して|してよい)$`), function (m) {
    const o = objectOf(this, m)
    return o && `return ${o.en}${o.from} to ${m[5] === '手札' ? 'hand' : 'the deck'}`
  }],
  [objRe('退却させ(?:る|て|てよい)?'), function (m) {
    const o = objectOf(this, m)
    return o && `retire ${o.en}${o.from}`
  }],
  [objRe('【スタンド】(?:させ(?:る|て|てよい)?|する|し|して)'), function (m) {
    const o = objectOf(this, m)
    return o && `[Stand] ${o.en}`
  }],
  [objRe('【レスト】(?:する|し|させる|させ|して)'), function (m) {
    const o = objectOf(this, m)
    return o && `[Rest] ${o.en}`
  }],
  [new RegExp(`^${OBJ}(ソウル|ドロップ|ドロップゾーン|ダメージゾーン|オーダーゾーン|バインドゾーン|Gゾーン)に(表で|裏で)?置(?:く|き|いて|いてよい)$`), function (m) {
    const o = objectOf(this, m)
    return o && `put ${o.en}${o.from} into ${intoZone(m[5])}${m[6] ? ` ${m[6] === '表で' ? 'face up' : 'face down'}` : ''}`
  }],
  [new RegExp(`^${OBJ}(?:あなたの)?山札の(上|下|上か下)に((?:好きな|望む)順(?:番)?で)?置(?:く|き|いて|いてよい)$`), function (m) {
    const o = objectOf(this, m)
    return o && `put ${o.en}${o.from} on ${{ 上: 'the top', 下: 'the bottom', 上か下: 'the top or bottom' }[m[5]]} of the deck${m[6] ? ' in any order' : ''}`
  }],
  [new RegExp(`^${OBJ}(裏で|表で)?バインド(?:する|し|して)$`), function (m) {
    const o = objectOf(this, m)
    return o && `bind ${o.en}${o.from}${m[5] === '裏で' ? ' face down' : m[5] === '表で' ? ' face up' : ''}`
  }],
  [objRe('捨て(?:る|て|てよい)?'), function (m) {
    const o = objectOf(this, m)
    return o && `discard ${o.en}${o.from}`
  }],
  [/^コストを払ってよい$/, () => 'you may pay the cost'],
  [/^以下を(\d+)つ(まで)?行う$/, (m) => `perform ${m[2] ? 'up to ' : ''}${numberWord(m[1])} of the following`],
  [/^(?:(.+?)は)?(⟦A\d+⟧(?:と⟦A\d+⟧)*)を得(?:る|て)$/, function (m) {
    const who = this.subj(m[1])
    if (!who) return null
    return `${who.en} ${who.plural ? 'get' : 'gets'} ${m[2].split('と').map((ph) => this.ctx.slot(ph)).join(' and ')}`
  }],
  [/^(?:(.+?)に)?(⟦A\d+⟧)を与え(?:る|て)?$/, function (m) {
    const who = m[1] ? np(m[1], this.ctx) : { en: this.obj, plural: this.obj === 'them' }
    if (!who) return null
    return `${who.en} ${who.plural ? 'get' : 'gets'} ${this.ctx.slot(m[2])}`
  }],
  [/^(?:(.+?)は)?ヒットされない$/, function (m) {
    const who = this.subj(m[1])
    return who ? `${who.en} cannot be hit` : null
  }],
  [STATS_RE, function (m) {
    const who = this.subj(m[1])
    if (!who) return null
    const also = this.also ? 'also ' : ''
    this.also = false
    const first = /^(パワー|クリティカル|シールド)/.exec(m[2])
    if (first) this.ctx.lastStat = STATS[first[1]]
    this.ctx.lastStatPlural = who.plural || who.en === 'they'
    // "パワー+5000してよい" -> "you may have this unit get [Power] +5000"
    if (MAY.test(m[0])) return `you may have ${who.en} ${also}get ${statList(m[2])}`
    return `${who.en} ${also}${who.plural || who.en === 'they' ? 'get' : 'gets'} ${statList(m[2])}`
  }],
  // "【治】トリガーはデッキに合計4枚まで入れられる" -> "you may only have up to four [Heal] triggers in a deck";
  // "【超】トリガーはデッキに1枚だけ入れられる" -> "you may only have one [Over] trigger in a deck"
  [/^(.+?)は(?:デッキに)?(?:合計)?(\d+)枚(まで|だけ)(?:しか)?入れられ(?:る|ない)$/, function (m) {
    const kinds = { '【治】': '[Heal] trigger', '【超】': '[Over] trigger', '【前】': '[Front] trigger', '【引】': '[Draw] trigger', '【醒】': '[Stand] trigger', '【クリティカル】': '[Critical] trigger' }
    const kind = kinds[m[1].replace(/トリガー$/, '')]
    const n = Number(m[2])
    const what = kind ? `${kind}${n === 1 ? '' : 's'}` : m[1] === '守護者' ? `card${n === 1 ? '' : 's'} with "Sentinel"` : /^⟦N\d+⟧$/.test(m[1]) ? `card${n === 1 ? '' : 's'} named ${this.ctx.slot(m[1])}` : null
    return what ? `you may only have ${m[3] === 'まで' ? 'up to ' : ''}${numberWord(n)} ${what} in a deck` : null
  }],
  [/^(?:(.+?)は)?(ソウル|ドロップ|手札|バインドゾーン)からでもプレイでき(?:る)?$/, function (m) {
    const who = this.subj(m[1])
    return who ? `${who.en} can be played from ${ZONES[m[2]]}` : null
  }],
  [/^このコストは(⟦A\d+⟧)でも払える$/, function (m) { return `this cost can also be paid with ${this.ctx.slot(m[1])}` }],
  [/^(?:(.+?)は)?後列からでもインターセプトでき$/, function (m) {
    const who = this.subj(m[1])
    return who ? `${who.en} can intercept from the back row` : null
  }],
  [/^このターンにあなたが(.+?)をプレイしている$/, function (m) {
    const what = np(m[1], this.ctx)
    return what ? `you played ${what.en} this turn` : null
  }],
  [/^(⟦N\d+⟧)のクレストを得(?:る|て)$/, function (m) {
    const name = this.ctx.slot(m[1])
    return `you get ${indefiniteFor(name.replace(/^"/, ''))} ${name} crest`
  }],
  // after "相手は手札から(G)にコールする際"
  [/^(\d+)枚以上同時にコールしない限りコールできない$/, (m) => `they must call ${numberWord(m[1])} or more at the same time`],
  [/^縦列を(\d+)つ選(?:び|ぶ)$/, (m) => (Number(m[1]) === 1 ? 'choose a column' : `choose ${numberWord(m[1])} columns`)],
  [/^(\d+)枚ではなく(\d+)枚(まで)?選(?:ぶ|び|んでよい)$/, (m) => `choose ${m[3] ? 'up to ' : ''}${numberWord(m[2])} cards instead of ${numberWord(m[1])}`],
  [/^(?:(.+?)は)?相手のカードの効果で選べ(?:ない|ず)$/, function (m) {
    const who = this.subj(m[1])
    return who ? `${who.en} cannot be chosen by your opponent's card effects` : null
  }],
  [/^このユニットのいるサークルにより以下を(\d+)つ行う$/, (m) => `perform ${numberWord(m[1])} of the following according to the circle this unit is on`],
  [/^以下すべてを行う$/, () => 'perform all of the following'],
  [/^このコストは(⟦B\d+⟧)減る$/, function (m) { return `reduce this cost by ${this.ctx.slot(m[1])}` }],
  [/^(⟦B\d+⟧)か(⟦B\d+⟧)(?:する|し)?$/, function (m) { return `${this.ctx.slot(m[1])} or ${this.ctx.slot(m[2])}` }],
  [/^このカード以外を(⟦B\d+⟧)$/, function (m) { return `${this.ctx.slot(m[1]).replace(/^\[|\]$/g, '')} other than this card` }],
  // G-era and older: "【ソウルブラスト】(1)-カード名に「X」を含むカード"
  [/^(⟦B\d+⟧)-(.+)$/, function (m) {
    const kw = this.ctx.slot(m[1]).replace(/^\[|\]$/g, '')
    const parsed = parseNP(m[2])
    if (!parsed || parsed.named || parsed.poss || parsed.isZone) return null
    parsed.plural = Number(/(\d+)$/.exec(kw)?.[1] ?? 1) > 1
    return `${kw} ${renderNP(parsed, this.ctx, { count: null, article: false }).en}`
  }],
  [/^(?:あなたの)?山札の上を公開(?:する|し)$/, function () {
    this.obj = 'it'
    return 'reveal the top card of your deck'
  }],
  [/^(?:(.+?)は)?【スタンド】でき(?:ない|ず)$/, function (m) {
    const who = this.subj(m[1])
    return who ? `${who.en} cannot [Stand]` : null
  }],
  [/^(?:(.+?)は)?相手のカードの効果で選ばれ(?:ない|ず)$/, function (m) {
    const who = this.subj(m[1])
    return who ? `${who.en} cannot be chosen by your opponent's card effects` : null
  }],
  // "相手ターンのガードステップ中、このカードはトリガーユニットとして(G)にコールでき、グレード0/シールド15000のガーディアンになり"
  [/^(?:(.+?)は)?トリガーユニットとして\(GC\)にコールでき(?:る)?$/, function (m) {
    const who = this.subj(m[1])
    return who ? `${who.en} can be called to (GC) as a trigger unit` : null
  }],
  [/^グレード(\d+)\/シールド(\d+)のガーディアンにな(?:り|る)$/, (m) => `it becomes a grade ${m[1]}/[Shield] ${m[2]} guardian`],
  [/^(?:(.+?)は)?後列からでもアタックでき(?:る)?$/, function (m) {
    const who = this.subj(m[1])
    return who ? `${who.en} can attack from the back row` : null
  }],
  [/^(?:(.+?)を)?\((VC|RC|GC)\)に移動させ(?:る|て)?$/, function (m) {
    const what = this.object(m[1])
    return what === null ? null : `move ${what} to (${m[2]})`
  }],
  [/^(?:(.+?)は)?ライドでき(?:ず|ない)$/, function (m) {
    const who = this.subj(m[1])
    return who && /card$/.test(who.en) ? `${who.en} cannot be ridden` : null
  }],
  [/^あなたは手札からライドできない$/, () => 'you cannot ride from hand'],
  [/^あなたはライドできない$/, () => 'you cannot ride'],
  [/^(?:(.+?)は)?手札から\(RC\)にノーマルコールできない$/, function (m) {
    const who = this.subj(m[1])
    return who && /card$/.test(who.en) ? `${who.en} cannot be normal called to (RC) from hand` : null
  }],
  // "「X」を含むあなたのリアガードを望む枚数選び" -> "choose any number of your rear-guards with "X" in their card names"
  [/^(?:(.+?)から)?(.+?)を望む枚数選(?:び|ぶ|んで)$/, function (m) {
    const parsed = parseNP(m[2])
    if (!parsed || parsed.named || parsed.isZone) return null
    const from = m[1] ? zoneList(m[1]) : null
    if (m[1] && !from) return null
    const poss = parsed.zone ? null : parsed.poss
    if (poss) parsed.poss = null
    parsed.plural = true
    this.obj = 'them'
    return `choose any number of ${poss ? `${poss} ` : ''}${renderNP(parsed, this.ctx, { article: false }).en}${from ? ` from ${from}` : ''}`
  }],
  [/^(?:(.+?)は)?相手のカードの効果で退却(?:せず|しない)$/, function (m) {
    const who = this.subj(m[1])
    return who ? `${who.en} cannot be retired by your opponent's card effects` : null
  }],
  [/^(?:(.+?)は)?アタックもブーストもできない$/, function (m) {
    const who = this.subj(m[1])
    return who ? `${who.en} cannot attack or boost` : null
  }],
  [/^以下を(\d+)つ行い$/, (m) => `perform ${numberWord(m[1])} of the following`],
  [/^手札から(\d+)枚捨てずにライドできる$/, (m) => `you can ride without discarding ${cards(m[1])} from hand`],
  // "相手の前列のユニットすべてとバトルする" -> "it battles all of your opponent's front row units"
  [/^(?:(.+?)は)?(.+?)とバトルする$/, function (m) {
    const who = this.subj(m[1])
    const whom = np(m[2], this.ctx)
    return who && whom ? `${who.en} ${who.plural ? 'battle' : 'battles'} ${whom.en}` : null
  }],
  // "手札から守護者を(G)にコールできない" -> "cannot call sentinels from hand to (GC)"
  [/^(?:(手札|ドロップ|ソウル)から)?(.+?)を\((GC|RC)\)にコールできない$/, function (m) {
    const parsed = parseNP(m[2])
    if (!parsed || parsed.named) return null
    parsed.plural = true
    // Only with a stated subject ("相手は…"): who can't call isn't guessed.
    const who = this.subject
    if (!who) return null
    return `${who.en} cannot call ${renderNP(parsed, this.ctx, { article: false }).en}${m[1] ? ` from ${ZONES[m[1]]}` : ''} to (${m[3]})`
  }],
  // "このカードは「X」としても扱う" -> "this card is also regarded as "X""
  [/^(?:(.+?)は)?(.+?)として(も)?扱う$/, function (m) {
    const who = this.subj(m[1])
    const grade = /^グレード(\d+)$/.exec(m[2])
    const as = grade ? { en: `grade ${grade[1]}` } : np(m[2], this.ctx)
    return who && as ? `${who.en} ${who.plural ? 'are' : 'is'} ${m[3] ? 'also ' : ''}regarded as ${as.en}` : null
  }],
]

// ---------------------------------------------------------------------------
// Lines and bodies
// ---------------------------------------------------------------------------

// A comma after a subject or a modifier ("このユニットが、(V)か(R)に登場した時",
// "あなたの、ソウルかドロップから") doesn't end the clause.
function mergeClauses(chunks) {
  const out = []
  for (const chunk of chunks) {
    const prev = out[out.length - 1]
    // "リアガードを2枚以上、望む枚数ソウルに置く" is "put two or more rear-guards into soul".
    if (prev && /枚以上$/.test(prev) && chunk.startsWith('望む枚数')) {
      out[out.length - 1] = prev + chunk.slice(4)
      continue
    }
    // A noun list split at "か、" ("「X」を含むカードか、ブリッツオーダーを...")
    // is one clause too; a verb or "時" before the か makes it a clause list.
    const nounOr = /(?:カード|ユニット|ヴァンガード|リアガード|オーダー|トークン|⟧)か$/.test(prev || '')
    // Any other "…か、" ("公開したか、", "コールするか、") ors two clauses,
    // read together by the "か、" rules.
    const clauseOr = !nounOr && /か$/.test(prev || '')
    // A modifier ("…を持つ、", "…を含む、") runs on into its noun; so does
    // a time ("あなたのバトルフェイズに、…が…時", read without the comma).
    const modifier = /(?:を持つ|を持たない|を含む|を含まない)$/.test(prev || '')
    const time = /(?:ターン|フェイズ)に$/.test(prev || '')
    if (prev && (nounOr || clauseOr || modifier || time || (/(?:の|が|から|を|と)$/.test(prev) && !/(?:時|なら|ことで)$/.test(prev)))) out[out.length - 1] = `${prev}${/の$/.test(prev) || modifier || clauseOr ? '、' : ''}${chunk}`
    else out.push(chunk)
  }
  return out
}

/**
 * Sentences at top-level 。 and !, each with the mark that ended it ("パワー
 * +10000!さらに…" is two sentences, the first ending in "!").
 */
function sentences(text) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (OPENERS.includes(ch)) depth++
    else if (CLOSERS.includes(ch)) depth = Math.max(0, depth - 1)
    if (depth === 0 && (ch === '。' || ch === '!')) {
      if (cur.trim()) out.push({ text: cur.trim(), end: ch === '!' ? '!' : '.' })
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim()) out.push({ text: cur.trim(), end: '.' })
  return out
}

/** Translates body text (one or more sentences). */
export function translateBody(text, ctx) {
  const body = protect(text, ctx)
  return sentences(body)
    .map(({ text: sentence, end }) => {
      const st = new Sentence(ctx)
      st.end = end
      for (const clause of mergeClauses(splitTop(sentence, '、'))) {
        if (!st.clause(clause)) st.raw(clause)
      }
      return st.render()
    })
    .join(' ')
}

/** A granted ability ("『【自】：...』") or an ability name ("『ブースト』"). */
function translateAbility(inner, ctx) {
  const s = inner.trim()
  if (KEYWORDS[s]) return KEYWORDS[s].replace(/^\[|\]$/g, '')
  if (s === 'ブースト') return 'Boost'
  if (s === 'インターセプト') return 'Intercept'
  return translateLine(s, ctx)
}

/** Translates one ability line. */
export function translateLine(line, ctx) {
  let s = line.trim()
  let bullet = ''
  if (s.startsWith('・')) {
    bullet = '• '
    s = s.slice(1).trim()
  }
  for (const [re, en] of FIXED_LINES) {
    const m = re.exec(s)
    if (m) return bullet + en(...m.slice(1))
  }
  // "先駆(...)", "盟主(...)": a keyword with its reminder.
  const kw = /^(先駆|守護者|盟主)\((.+)\)$/.exec(s)
  if (kw) {
    const r = reminder(kw[2])
    if (r) return `${bullet}${{ 先駆: 'Forerunner', 守護者: 'Sentinel', 盟主: 'Lord' }[kw[1]]} (${r})`
  }

  // An [Over] trigger's "追加効果-…" (the dash often arrives as "?").
  const extra = /^追加効果[-?](.+)$/.exec(s)
  if (extra) return `${bullet}Additional Effect - ${ctx.fill(translateBody(extra[1], ctx))}`

  // A labelled bullet: "・(G)-…" -> "• (GC) - …", "・「X」を含むカード-…" -> "• Card with "X" in its card name - …".
  const labelled = bullet && /^([^:【\s-][^:【\s]{0,39}?)-(?!【[自永起]】)(.+)$/.exec(s)
  if (labelled) {
    const count = /^(\d+)枚以上$/.exec(labelled[1])
    const label = CIRCLES[labelled[1]] || (count ? `${numberWord(count[1])} or more` : np(protect(labelled[1], ctx), ctx, { article: false })?.en)
    if (label) return `${bullet}${capitalize(ctx.fill(label))} - ${ctx.fill(translateBody(labelled[2], ctx))}`
  }

  const header = parseHeader(s, ctx)
  if (!header) {
    if (/^(?:[^【:]{0,12}-)?【[自永起]】/.test(s)) debug.headers?.push(generalized(s.slice(0, s.indexOf(':') + 1 || 30)))
    return bullet + ctx.fill(translateBody(s, ctx))
  }
  let rest = protect(header.rest, ctx)
  let cost = ''
  // G-era and older: the cost comes first, as a bare "[...]".
  const lead = /^(⟦Q\d+⟧)/.exec(rest)
  if (lead) {
    cost = `${ctx.slot(lead[1])} `
    rest = rest.slice(lead[1].length)
  }
  return bullet + header.en + cost + ctx.fill(translateBody(rest, ctx))
}
