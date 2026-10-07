'use strict';

/**
 * Which card "series" the Cardfight!! Vanguard Wiki scrape covers, shared by
 * scrape-fandom.js (what to keep) and match-fandom.js (what to match).
 *
 * A series is read off a card code's prefix, on both sites:
 *   D     "D-BT01/001"     D-era (2020-2023)
 *   DZ    "DZ-BT17/001"    D-era, "Divinez" (2023-)
 *   V     "V-EB05/SSP01"   V-era (2017-2020)
 *   G     "G-BT01/001"     G-era (2013-2017)
 *   OLD   "BT01/002", "PR/0089", "TD01/005"   the original series and every
 *                          set code with no series prefix (EB, FC, KAD, MB...)
 * Codes with any other prefix ("VG-...") belong to no supported series.
 *
 * D and DZ are one family for matching: the wiki lists a D-era card's reprints
 * across both, so a yuyu-tei "D-" card may match a page that only has "DZ-"
 * codes. Every other series is its own family, which keeps a V-era card from
 * being matched by name to an unrelated D-era card that shares it.
 */

const ALL_SERIES = ['D', 'DZ', 'V', 'G', 'OLD'];

// A set code as the wiki prints it ("DZ-BT17/SEC01", "BT01/S02", "D-PR/756",
// "DZ-SS04e/012EN"): optional series prefix, set, "/", number with optional
// letters around it. The lookbehind stops "BT17/001" being read out of the
// middle of "DZ-BT17/001".
const CARD_CODE_RE = /(?<![A-Za-z0-9-])(?:(?:DZ|D|V|G)-)?[A-Za-z]+\d*[A-Za-z]*\/[A-Za-z]*\d+[A-Za-z]*(?![A-Za-z0-9])/g;
// Codes of English/Thai/Korean printings -- yuyu-tei only sells Japanese ones.
const FOREIGN_CODE_RE = /(EN|TH|KR)(\/|$)/i;

/** The series a card code belongs to, or null (unsupported prefix / not a card code). */
function seriesOfCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (c.startsWith('DZ-')) return 'DZ';
  if (c.startsWith('D-')) return 'D';
  if (c.startsWith('V-')) return 'V';
  if (c.startsWith('G-')) return 'G';
  if (c.includes('-')) return null;
  return /^[A-Z]+\d*[A-Z]*\//.test(c) ? 'OLD' : null;
}

/** D and DZ share a family; every other series is its own. */
function familyOfCode(code) {
  const series = seriesOfCode(code);
  return series === 'DZ' ? 'D' : series;
}

/** "D,DZ,V" -> ['D', 'DZ', 'V']; throws on an unknown name so a typo can't silently scrape nothing. */
function parseSeries(arg) {
  const names = String(arg).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const unknown = names.filter((n) => !ALL_SERIES.includes(n));
  if (names.length === 0 || unknown.length > 0) {
    throw new Error(`Unknown --series "${unknown.join(',') || arg}" (supported: ${ALL_SERIES.join(', ')})`);
  }
  return ALL_SERIES.filter((s) => names.includes(s));
}

module.exports = { ALL_SERIES, CARD_CODE_RE, FOREIGN_CODE_RE, seriesOfCode, familyOfCode, parseSeries };
