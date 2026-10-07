'use strict';

/**
 * A card's nation, for the Market Movers nation filter.
 *
 * The `clan` field holds different things by era and by source:
 *  - D-/DZ- cards: the nation itself ("Keter Sanctuary" from cf-vanguard or
 *    the wiki, "ケテルサンクチュアリ" from a yuyu-tei detail page) -- the D
 *    era has no clans;
 *  - earlier cards: their clan, in English or Japanese ("Royal Paladin",
 *    "ロイヤルパラディン"), which belongs to one of the classic nations;
 *  - title/collab cards: the title ("Touken Ranbu", "BanG Dream!", ...);
 *  - noise: "-", "Grade 0", null, ...
 *
 * Classic clan -> nation follows the Cardfight!! Vanguard Wiki's clan pages
 * (checked 2026-10-07). Dragon Empire is one nation in both eras, so classic
 * Kagero/Narukami/... cards share the D-era Dragon Empire code. Cray Elemental
 * has no nation, and neither does anything unrecognized: such cards simply
 * carry no nation and only show under "All nations".
 *
 * Codes are short because every slim-catalog card carries one; the labels
 * ship once, in catalog.json's `nations` list (see catalog-split.js).
 */

// Display order of the filter: the current (D-era) nations, then the classic
// ones, then the collab bucket. `group` becomes the filter's <optgroup>.
const NATIONS = [
  { code: 'DE', label: 'Dragon Empire', group: 'Nations' },
  { code: 'DS', label: 'Dark States', group: 'Nations' },
  { code: 'BG', label: 'Brandt Gate', group: 'Nations' },
  { code: 'KS', label: 'Keter Sanctuary', group: 'Nations' },
  { code: 'ST', label: 'Stoicheia', group: 'Nations' },
  { code: 'LM', label: 'Lyrical Monasterio', group: 'Nations' },
  { code: 'US', label: 'United Sanctuary', group: 'Classic nations' },
  { code: 'DZ', label: 'Dark Zone', group: 'Classic nations' },
  { code: 'SG', label: 'Star Gate', group: 'Classic nations' },
  { code: 'MG', label: 'Magallanica', group: 'Classic nations' },
  { code: 'ZO', label: 'Zoo', group: 'Classic nations' },
  { code: 'TC', label: 'Title collabs', group: 'Other' },
];

// clan value (English and Japanese spellings as they occur in the data) -> code
const BY_CLAN = new Map(Object.entries({
  // D-era nations
  'Dragon Empire': 'DE', 'ドラゴンエンパイア': 'DE',
  'Dark States': 'DS', 'ダークステイツ': 'DS',
  'Brandt Gate': 'BG', 'ブラントゲート': 'BG',
  'Keter Sanctuary': 'KS', 'ケテルサンクチュアリ': 'KS',
  'Stoicheia': 'ST', 'ストイケイア': 'ST',
  'Lyrical Monasterio': 'LM', 'リリカルモナステリオ': 'LM',
  // classic nations named directly
  'United Sanctuary': 'US', 'ユナイテッドサンクチュアリ': 'US',
  'Dark Zone': 'DZ', 'ダークゾーン': 'DZ',
  'Star Gate': 'SG', 'スターゲート': 'SG',
  'Magallanica': 'MG', 'メガラニカ': 'MG',
  'Zoo': 'ZO', 'ズー': 'ZO',
  // United Sanctuary clans
  'Royal Paladin': 'US', 'ロイヤルパラディン': 'US',
  'Shadow Paladin': 'US', 'シャドウパラディン': 'US',
  'Gold Paladin': 'US', 'ゴールドパラディン': 'US',
  'Oracle Think Tank': 'US', 'オラクルシンクタンク': 'US',
  'Angel Feather': 'US', 'エンジェルフェザー': 'US',
  'Genesis': 'US', 'ジェネシス': 'US',
  // Dragon Empire clans
  'Kagero': 'DE', 'かげろう': 'DE',
  'Narukami': 'DE', 'なるかみ': 'DE',
  'Tachikaze': 'DE', 'たちかぜ': 'DE',
  'Murakumo': 'DE', 'むらくも': 'DE',
  'Nubatama': 'DE', 'ぬばたま': 'DE',
  // Dark Zone clans
  'Spike Brothers': 'DZ', 'スパイクブラザーズ': 'DZ',
  'Dark Irregulars': 'DZ', 'ダークイレギュラーズ': 'DZ',
  'Pale Moon': 'DZ', 'ペイルムーン': 'DZ',
  'Gear Chronicle': 'DZ', 'ギアクロニクル': 'DZ',
  // Star Gate clans
  'Nova Grappler': 'SG', 'ノヴァグラップラー': 'SG',
  'Dimension Police': 'SG', 'ディメンジョンポリス': 'SG',
  'Link Joker': 'SG', 'リンクジョーカー': 'SG',
  'Etranger': 'SG', 'エトランジェ': 'SG',
  // Magallanica clans
  'Bermuda Triangle': 'MG', 'バミューダ△': 'MG',
  'Aqua Force': 'MG', 'アクアフォース': 'MG',
  'Granblue': 'MG', 'グランブルー': 'MG',
  // Zoo clans
  'Megacolony': 'ZO', 'メガコロニー': 'ZO',
  'Great Nature': 'ZO', 'グレートネイチャー': 'ZO',
  'Neo Nectar': 'ZO', 'ネオネクタール': 'ZO',
  // title/collab sets
  'Touken Ranbu': 'TC', '刀剣乱舞': 'TC',
  'BanG Dream!': 'TC', 'BanGDream!': 'TC',
  "Poppin'Party": 'TC', 'Poppin’Party': 'TC', 'Afterglow': 'TC', 'Pastel＊Palettes': 'TC',
  'Roselia': 'TC', 'ハロー、ハッピーワールド！': 'TC', 'RAISE A SUILEN': 'TC',
  'SHAMAN KING': 'TC', 'Shaman King': 'TC',
  'Monster Strike': 'TC', 'モンスターストライク': 'TC',
  'Inazuma Eleven': 'TC', 'イナズマイレブン': 'TC',
  'Record of Ragnarok': 'TC', '終末のワルキューレ': 'TC',
  'Buddyfight': 'TC', 'バディファイト': 'TC',
  'CoroCoro': 'TC', 'コロコロ': 'TC',
}));

const KNOWN_CODES = new Set(NATIONS.map((n) => n.code));

function codeOf(clan) {
  // BanG Dream! song cards are filed as "楽曲/<band>".
  const name = clan.startsWith('楽曲/') ? clan.slice('楽曲/'.length) : clan;
  return BY_CLAN.get(name) ?? null;
}

/**
 * The card's nation code, an array of codes for a card in several nations
 * ("ドラゴンエンパイア/ストイケイア"), or null when it has none we recognize.
 */
function nationOf(clan) {
  if (typeof clan !== 'string' || clan === '') return null;
  const whole = codeOf(clan);
  if (whole) return whole;
  if (!clan.includes('/')) return null;
  const codes = [...new Set(clan.split('/').map((part) => codeOf(part.trim())).filter(Boolean))];
  if (codes.length === 0) return null;
  return codes.length === 1 ? codes[0] : codes;
}

module.exports = { NATIONS, KNOWN_CODES, nationOf };
