// Hand-written Japanese -> English vocabulary for card rules text, in the
// house style of the official English card database (en.cf-vanguard.com):
// "[AUTO](VC)[1/Turn]:", "[COST][Counter-Blast 1]", "[Power] +5000".
// Everything the translator writes that isn't a card name comes from here
// or from grammar.js's sentence templates. A term missing from these
// tables is left in Japanese rather than guessed.

// The ability's type icon, first in its header.
export const ICONS = {
  自: '[AUTO]',
  永: '[CONT]',
  起: '[ACT]',
}

// Where an ability works from: the circle markers, and the zones that
// appear in a header's 【】 ("【永】【手札】" -> "[CONT](Hand)").
export const CIRCLES = {
  '(V)': '(VC)',
  '(R)': '(RC)',
  '(G)': '(GC)',
}

export const ZONES = {
  手札: 'hand',
  山札: 'deck',
  ソウル: 'soul',
  ドロップ: 'drop',
  ドロップゾーン: 'drop',
  ダメージゾーン: 'damage zone',
  バインドゾーン: 'bind zone',
  オーダーゾーン: 'order zone',
  Gゾーン: 'G zone',
  トリガーゾーン: 'trigger zone',
  ゲージゾーン: 'gauge zone',
  必殺技ゾーン: 'special move zone',
  ライドデッキ: 'ride deck',
  モンスターBOX: 'Monster BOX',
  監獄: 'Prison',
}

// Header keywords that limit or label an ability ("【ターン1回】",
// "【Gブレイク】(2)"). Values are functions of the count in "(n)", when any.
export const HEADER_KEYWORDS = {
  ターン1回: () => '[1/Turn]',
  ターン2回: () => '[2/Turn]',
  ファイト1回: () => '[1/Fight]',
  Gブレイク: (n) => `[Generation Break ${n}]`,
  リミットブレイク: (n) => `[Limit Break ${n}]`,
  LB: (n) => `[Limit Break ${n}]`,
  ディヴァインスキル: () => '[Divine Skill]',
  ファントムスキル: () => '[Phantom Skill]',
  ユニークスキル: () => '[Unique Skill]',
  旋律: () => '[Melody]',
  煌求者: () => '[Glitter Seeker]',
  ドレスブースト: () => '[Dress Boost]',
  ストライクショット: () => '[Strike Shot]',
  究極超越: () => '[Ultimate Stride]',
  邪竜解放: () => '[Evil Dragon Release]',
  神器錬成: () => '[Regalia Refining]',
}

// 【】 keywords inside the body. Costs and charges take a count
// ("【カウンターブラスト】(1)" -> "[Counter-Blast 1]").
export const COUNTED = {
  カウンターブラスト: 'Counter-Blast',
  ソウルブラスト: 'Soul-Blast',
  エネルギーブラスト: 'Energy-Blast',
  ソウルチャージ: 'Soul-Charge',
  カウンターチャージ: 'Counter-Charge',
  エネルギーチャージ: 'Energy-Charge',
}

export const KEYWORDS = {
  スタンド: '[Stand]',
  レスト: '[Rest]',
  超越: '[Stride]',
  ブースト: '[Boost]',
  インターセプト: '[Intercept]',
  双闘: '[Legion]',
  Gガーディアン: 'G guardian',
  オーバードレス: '[overDress]',
  クロスオーバードレス: '[XoverDress]',
  ユニゾンドレス: '[UnisonDress]',
  レヴォルドレス: '[RevolDress]',
  ドラグドレス: '[DragDress]',
  オーバーソウル: '[Oversoul]',
  レガリスピース: '[Regalis Piece]',
  ディヴァインスキル: '[Divine Skill]',
  ファントムスキル: '[Phantom Skill]',
  ユニークスキル: '[Unique Skill]',
  旋律: '[Melody]',
  煌求者: '[Glitter Seeker]',
  ドロー: '[Draw]',
  // Trigger icons.
  治: '[Heal]',
  前: '[Front]',
  引: '[Draw]',
  超: '[Over]',
  醒: '[Stand]',
  クリティカル: '[Critical]',
  シールド: '[Shield]',
}

// Stat names in "パワー＋5000" style modifiers.
export const STATS = {
  パワー: '[Power]',
  クリティカル: '[Critical]',
  シールド: '[Shield]',
  ドライブ: 'drive',
  グレード: 'grade',
}

// Card types, for the modal's stat pills and for nouns in the text.
export const KINDS = {
  ノーマルユニット: 'Normal Unit',
  トリガーユニット: 'Trigger Unit',
  Gユニット: 'G Unit',
  ノーマルオーダー: 'Normal Order',
  セットオーダー: 'Set Order',
  ブリッツオーダー: 'Blitz Order',
  トリガーオーダー: 'Trigger Order',
  ギフトマーカー: 'Gift Marker',
  トークンユニット: 'Token Unit',
  必殺技: 'Special Move',
  'その他': 'Other',
}

// Nations, clans and collab titles: every Japanese spelling that
// pipeline/nation.js recognizes (a pipeline test keeps the two in step),
// plus the few the detail scrape carries that nation.js doesn't bucket.
export const CLANS = {
  ドラゴンエンパイア: 'Dragon Empire',
  ダークステイツ: 'Dark States',
  ブラントゲート: 'Brandt Gate',
  ケテルサンクチュアリ: 'Keter Sanctuary',
  ストイケイア: 'Stoicheia',
  リリカルモナステリオ: 'Lyrical Monasterio',
  ユナイテッドサンクチュアリ: 'United Sanctuary',
  ダークゾーン: 'Dark Zone',
  スターゲート: 'Star Gate',
  メガラニカ: 'Magallanica',
  ズー: 'Zoo',
  ロイヤルパラディン: 'Royal Paladin',
  シャドウパラディン: 'Shadow Paladin',
  ゴールドパラディン: 'Gold Paladin',
  オラクルシンクタンク: 'Oracle Think Tank',
  エンジェルフェザー: 'Angel Feather',
  ジェネシス: 'Genesis',
  かげろう: 'Kagero',
  なるかみ: 'Narukami',
  たちかぜ: 'Tachikaze',
  むらくも: 'Murakumo',
  ぬばたま: 'Nubatama',
  スパイクブラザーズ: 'Spike Brothers',
  ダークイレギュラーズ: 'Dark Irregulars',
  ペイルムーン: 'Pale Moon',
  ギアクロニクル: 'Gear Chronicle',
  ノヴァグラップラー: 'Nova Grappler',
  ディメンジョンポリス: 'Dimension Police',
  リンクジョーカー: 'Link Joker',
  エトランジェ: 'Etranger',
  'バミューダ△': 'Bermuda Triangle',
  アクアフォース: 'Aqua Force',
  グランブルー: 'Granblue',
  メガコロニー: 'Megacolony',
  グレートネイチャー: 'Great Nature',
  ネオネクタール: 'Neo Nectar',
  クレイエレメンタル: 'Cray Elemental',
  刀剣乱舞: 'Touken Ranbu',
  'ハロー、ハッピーワールド！': 'Hello, Happy World!',
  モンスターストライク: 'Monster Strike',
  イナズマイレブン: 'Inazuma Eleven',
  終末のワルキューレ: 'Record of Ragnarok',
  バディファイト: 'Buddyfight',
  コロコロ: 'CoroCoro',
  ペルソナシリーズ: 'Persona',
  シャーマンキング: 'Shaman King',
  'ぶいすぽっ！': 'VSPO!',
}

// Races in 〈〉 ("〈プレアドラゴン〉" -> "<Prayer Dragon>"): the official
// English where the official database shows it, otherwise the wiki's (each
// seen on at least two wiki cards). Names already in English (bands) pass
// through; a race missing here stays in Japanese.
export const RACES = {
  プレアドラゴン: 'Prayer Dragon',
  ドラゴン: 'Dragon',
  幻影: 'Fantôme',
  ディノドラゴン: 'Dinodragon',
  共心竜: 'Unison Dragon',
  インセクト: 'Insect',
  マーメイド: 'Mermaid',
  ハイビースト: 'High Beast',
  ティアードラゴン: 'Tear Dragon',
  ワーカロイド: 'Workeroid',
  ゲノムゲル: 'Genomegel',
  ギアドラゴン: 'Gear Dragon',
  バトロイド: 'Battleroid',
  タリスマン: 'Talisman',
  ヒュドラグルム: 'Hydragrum',
  五つ子: 'Quintuplet',
  十二支刻獣: 'Zodiac Time Beast',
  ストーリー: 'Story',
  ゴースト: 'Ghost',
  メサイア: 'Messiah',
  クロニクル: 'Chronicle',
  ドラゴロイド: 'Dragoroid',
  神: 'God',
  フレイムドラゴン: 'Flame Dragon',
  ギアコロッサス: 'Gear Colossus',
  シャーマン: 'Shaman',
  星詠: 'Astral Poet',
  戦乙女: 'Valkyrie',
  ヒーロー: 'Hero',
  サイバードラゴン: 'Cyber Dragon',
  ゼロスドラゴン: 'Zeroth Dragon',
  星神: 'Astral Deity',
  ギアビースト: 'Gear Beast',
  ノーブル: 'Noble',
  オシャレ魔女: 'Fashionable Witch',
  ムシ: 'Mushi',
  運命の巻戻士: 'Fate Rewinder',
  警察: 'Police',
  葬送のフリーレン: "Frieren: Beyond Journey's End",
  龍が如く: 'Yakuza',
  勇気爆発バーンブレイバーン: 'Brave Bang Bravern!',
  '刀剣男士-打刀': 'Touken Danshi - Uchigatana',
  '刀剣男士-脇差': 'Touken Danshi - Wakizashi',
  '刀剣男士-太刀': 'Touken Danshi - Tachi',
  RAISEASUILEN: 'RAISE A SUILEN',
}

// Token names ("プラント・トークン" -> "Plant token"), as the official
// English writes them (妖魔変幻 from the wiki).
export const TOKENS = {
  プラント: 'Plant',
  夜影兵: 'Shadow Army',
  ノブレスローズ: 'Noblesserose',
  モモッケ: 'Momokke',
  'SYSTEM CODE:X-ceed': 'SYSTEM CODE: X-ceed',
  清逸なる高貴の庭園: 'Blodeuwedd Garden',
  リグレイン生命創成研究所: 'Regrain Biocreation Research Lab',
  時辰儀・宿命之翼: 'Destined Timepiece',
  '魔獣合成体 ユーバーメンシュ': 'Demonic Beast Alchemix Body, Ubermensch',
  龍樹開花・天地終焉: 'Gripho Eschatologui',
  妖魔変幻: 'Evil Decoy',
}

// Words that are already English (band names, "SHAMAN KING"...) pass
// through untouched; only these need a mapping.
const SLASH_PREFIXES = { '楽曲/': 'Song/' }

/** English for a kind or clan value from the detail scrape, or the input unchanged. */
export function translateTerm(value) {
  if (typeof value !== 'string' || value === '') return value
  if (Object.hasOwn(KINDS, value)) return KINDS[value]
  if (Object.hasOwn(CLANS, value)) return CLANS[value]
  for (const [prefix, en] of Object.entries(SLASH_PREFIXES)) {
    if (value.startsWith(prefix)) return en + translateTerm(value.slice(prefix.length))
  }
  // Multi-nation cards: "ドラゴンエンパイア/ストイケイア".
  if (value.includes('/')) return value.split('/').map(translateTerm).join('/')
  return value
}
