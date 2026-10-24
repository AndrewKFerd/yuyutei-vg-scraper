import { formatPrice } from './currency'
import { derivedImageUrl } from './catalogFormat'
import { formatDate, formatPctMagnitude, pctChange } from './format'
import { imageUrl2x, imageUrlHd } from './images'
import { itemName } from './savedListsData'

// A saved list as a PDF, built in the browser: four cards to an A4 page,
// each card's art with its price underneath. Every page is drawn on a
// canvas and embedded as one JPEG, so Japanese names and any currency
// symbol print exactly as on screen without shipping a font, and the PDF
// around the pages is a handful of hand-written objects (no library).
//
// The art comes from yuyu-tei's CDN, which sends Access-Control-Allow-Origin
// *, so a crossOrigin <img> (allowed by img-src) leaves the canvas readable.

const DPI = 200
const PAGE_W_MM = 210
const PAGE_H_MM = 297
const PAGE_W_PT = 595.28
const PAGE_H_PT = 841.89
const px = (mm) => Math.round((mm / 25.4) * DPI)
const pt = (size) => Math.round((size / 72) * DPI)

// Layout, in mm: a header, a 2 × 2 grid, a footer. Each grid cell is the
// card art (63:88, a real card's shape) centred over its caption.
const MARGIN = 14
const HEADER_H = 18
const FOOTER_H = 8
const GAP_X = 10
const GAP_Y = 8
const CAPTION_H = 30
const PER_PAGE = 4
const WATERMARK = 64
const WATERMARK_ALPHA = 0.12

const APP_NAME = 'Yuyu-tei Card Search'
// The app mark (same artwork as Logo.jsx). Same-origin, so it leaves the
// canvas readable; drawn at whatever size the page wants, as it's a vector.
const LOGO_URL = '/favicon.svg'

// The light theme's tokens (index.css), whatever theme the page is in: a
// PDF is for paper.
const INK = {
  fg: '#0f172a',
  muted: '#475569',
  subtle: '#64748b',
  line: '#e2e8f0',
  fill: '#f1f5f9',
  accent: 'hsl(212 68% 44%)',
  positive: '#15803d',
  negative: '#b91c1c',
  warning: '#b45309',
}

// RarityBadge's colours, as [background, text].
const RARITY_INK = {
  SEC: ['#eecf99', 'hsl(38 48% 30%)'],
  SP: ['#eecf99', 'hsl(38 48% 30%)'],
  FFR: ['#7e22ce', '#fff'],
  SR: ['#7e22ce', '#fff'],
  RRR: ['#be185d', '#fff'],
  RR: ['hsl(212 68% 44%)', '#fff'],
  R: ['#15803d', '#fff'],
  C: ['#cbd5e1', '#1e293b'],
}
const RARITY_DEFAULT = ['#e2e8f0', '#1e293b']

// --- images ------------------------------------------------------------------

const IMAGE_TIMEOUT_MS = 20_000
const IMAGE_CONCURRENCY = 6
// How much of the progress the art downloads account for; drawing and
// encoding the pages is the rest.
const ART_SHARE = 0.9

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    const timer = setTimeout(() => done(null), IMAGE_TIMEOUT_MS)
    function done(result) {
      clearTimeout(timer)
      img.onload = img.onerror = null
      resolve(result)
    }
    img.crossOrigin = 'anonymous'
    img.onload = () => done(img)
    img.onerror = () => done(null)
    img.src = src
  })
}

// The 500×700 scan prints sharp at this size; the 200×280 one is the
// fallback, then whatever URL there is (a placeholder doesn't resize).
async function loadCardArt(row) {
  const url = row.card ? row.card.imageUrl : derivedImageUrl(row.id)
  if (!url) return null
  for (const src of [imageUrlHd(url), imageUrl2x(url), url]) {
    if (!src) continue
    const img = await loadImage(src)
    if (img) return img
  }
  return null
}

async function loadAllArt(rows, onProgress) {
  const art = new Array(rows.length).fill(null)
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < rows.length) {
      const i = next++
      art[i] = await loadCardArt(rows[i])
      onProgress?.(++done, rows.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, rows.length) }, worker))
  return art
}

// --- text --------------------------------------------------------------------

// Longest prefix (in code points, so surrogate pairs stay whole) that fits.
function fitLength(ctx, chars, maxWidth, suffix = '') {
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(chars.slice(0, mid).join('') + suffix).width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo
}

// Greedy wrap, breaking at a space where there is one (Japanese names have
// none, so they break anywhere); the last line ends in "…" if cut short.
function wrapText(ctx, text, maxWidth, maxLines) {
  const lines = []
  let rest = Array.from(text.trim())
  while (rest.length && lines.length < maxLines) {
    if (ctx.measureText(rest.join('')).width <= maxWidth) {
      lines.push(rest.join(''))
      break
    }
    if (lines.length === maxLines - 1) {
      lines.push(rest.slice(0, fitLength(ctx, rest, maxWidth, '…')).join('').trimEnd() + '…')
      break
    }
    let end = Math.max(1, fitLength(ctx, rest, maxWidth))
    const space = rest.lastIndexOf(' ', end)
    if (space > 0) end = space
    lines.push(rest.slice(0, end).join('').trimEnd())
    rest = rest.slice(end)
    while (rest[0] === ' ') rest.shift()
  }
  return lines
}

// Draws text runs side by side, centred on `cx`, each with its own font and
// colour: [{ text, font, color, badge?: [bg, fg] }].
function drawRuns(ctx, runs, cx, y) {
  const PAD = px(1.2)
  const widths = runs.map((run) => {
    ctx.font = run.font
    return ctx.measureText(run.text).width + (run.badge ? PAD * 2 : 0)
  })
  let x = cx - widths.reduce((a, b) => a + b, 0) / 2
  runs.forEach((run, i) => {
    ctx.font = run.font
    if (run.badge) {
      const h = pt(9)
      ctx.fillStyle = run.badge[0]
      ctx.beginPath()
      ctx.roundRect(x, y - h / 2, widths[i], h, px(0.8))
      ctx.fill()
      ctx.fillStyle = run.badge[1]
      ctx.fillText(run.text, x + PAD, y)
    } else {
      ctx.fillStyle = run.color
      ctx.fillText(run.text, x, y)
    }
    x += widths[i]
  })
}

// --- pages -------------------------------------------------------------------

function drawCard(ctx, row, img, box, { prices, currency, rates, pricesReady, font }) {
  const artH = box.h - px(CAPTION_H)
  const artW = Math.min(box.w, Math.round((artH * 63) / 88))
  const artX = box.x + (box.w - artW) / 2
  const radius = px(3)

  ctx.save()
  ctx.beginPath()
  ctx.roundRect(artX, box.y, artW, artH, radius)
  ctx.fillStyle = INK.fill
  ctx.fill()
  if (img) {
    // Contain, so an odd-shaped scan isn't stretched.
    const scale = Math.min(artW / img.naturalWidth, artH / img.naturalHeight)
    const w = img.naturalWidth * scale
    const h = img.naturalHeight * scale
    ctx.clip()
    ctx.drawImage(img, artX + (artW - w) / 2, box.y + (artH - h) / 2, w, h)
  } else {
    ctx.fillStyle = INK.subtle
    ctx.font = font(400, 9)
    ctx.textAlign = 'center'
    ctx.fillText('Image unavailable', artX + artW / 2, box.y + artH / 2)
    ctx.textAlign = 'left'
  }
  ctx.restore()
  ctx.beginPath()
  ctx.roundRect(artX, box.y, artW, artH, radius)
  ctx.strokeStyle = INK.line
  ctx.lineWidth = px(0.25)
  ctx.stroke()

  // Caption: name (two lines at most), number and rarity, then the price.
  const cx = box.x + box.w / 2
  let y = box.y + artH + px(5)
  ctx.textAlign = 'center'
  ctx.font = font(700, 10)
  ctx.fillStyle = INK.fg
  const nameLines = wrapText(ctx, itemName(row), box.w, 2)
  for (const line of nameLines) {
    ctx.fillText(line, cx, y)
    y += pt(12.5)
  }
  if (nameLines.length < 2) y += pt(3)
  ctx.textAlign = 'left'

  const meta = []
  if (row.setCode) meta.push({ text: row.setCode, font: font(400, 8, true), color: INK.muted })
  if (row.setCode && row.rarity) meta.push({ text: '  ', font: font(400, 8), color: INK.muted })
  if (row.rarity) meta.push({ text: row.rarity, font: font(700, 7), badge: RARITY_INK[row.rarity] || RARITY_DEFAULT })
  if (meta.length) drawRuns(ctx, meta, cx, y)
  y += pt(16)

  // No prices: just how many of the card the list holds.
  if (prices === 'none') {
    drawRuns(ctx, [{ text: `${row.qty} ${row.qty === 1 ? 'copy' : 'copies'}`, font: font(700, 12), color: INK.fg }], cx, y)
    return
  }

  // Current prices: today's alone, so a list passed on doesn't show what it
  // was worth when saved as if it were now. Saved prices: the saved price
  // leads, today's noted after it; a card saved without one shows today's,
  // marked as such (it isn't in the saved total).
  const current = prices === 'now'
  const unit = current ? row.now : (row.price ?? (pricesReady ? row.now : null))
  const converted = currency !== 'JPY' && Boolean(rates)
  if (current && row.now == null) {
    const text = row.card ? 'No price today' : 'No longer listed'
    drawRuns(ctx, [{ text, font: font(700, 11), color: INK.warning }], cx, y)
    return
  }
  const price = [{ text: formatPrice(unit, currency, rates), font: font(700, 14), color: INK.accent }]
  if (!current && row.price == null && unit != null) {
    price.push({ text: ' (today)', font: font(600, 9), color: INK.subtle })
  }
  if (row.qty > 1) price.push({ text: `  × ${row.qty}`, font: font(600, 10), color: INK.muted })
  drawRuns(ctx, price, cx, y)
  y += pt(12)

  const notes = []
  if (row.qty > 1 && unit != null) {
    notes.push({ text: `Subtotal ${formatPrice(unit * row.qty, currency, rates)}`, font: font(400, 8), color: INK.muted })
  }
  if (converted && unit != null) {
    if (notes.length) notes.push({ text: ' · ', font: font(400, 8), color: INK.subtle })
    notes.push({ text: formatPrice(unit * row.qty, 'JPY', null), font: font(400, 8), color: INK.subtle })
  }
  if (!current && pricesReady && row.price != null) {
    const sep = () => notes.length && notes.push({ text: ' · ', font: font(400, 8), color: INK.subtle })
    if (!row.card) {
      sep()
      notes.push({ text: 'No longer listed', font: font(600, 8), color: INK.warning })
    } else {
      const pct = pctChange(row.price, row.now)
      if (pct) {
        sep()
        notes.push({
          text: `Now ${formatPrice(row.now, currency, rates)} ${pct > 0 ? '▲' : '▼'}${formatPctMagnitude(pct)}`,
          font: font(600, 8),
          color: pct > 0 ? INK.positive : INK.negative,
        })
      }
    }
  }
  if (notes.length) drawRuns(ctx, notes, cx, y)
}

function drawPage(ctx, rows, art, page, pageCount, info) {
  const { list, totals, prices, pricesAt, currency, rates, font, logo } = info
  const W = ctx.canvas.width
  const H = ctx.canvas.height
  const left = px(MARGIN)
  const right = W - px(MARGIN)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'middle'

  // Header: list name and its total (or, with no prices, its copies), then
  // counts, which prices these are (as saved, or as of today) and where
  // they came from.
  const current = prices === 'now'
  const priced = prices !== 'none'
  const titleY = px(MARGIN) + pt(9)
  ctx.font = font(700, 13)
  ctx.textAlign = 'right'
  ctx.fillStyle = INK.accent
  const cards = rows.length
  const cardsText = `${cards} ${cards === 1 ? 'card' : 'cards'}`
  const copiesText = `${totals.copies} ${totals.copies === 1 ? 'copy' : 'copies'}`
  const total = priced
    ? `Total ${formatPrice(current ? totals.nowJpy : totals.savedJpy, currency, rates)}`
    : `${cardsText} · ${copiesText}`
  ctx.fillText(total, right, titleY)
  const totalW = ctx.measureText(total).width
  ctx.textAlign = 'left'
  ctx.font = font(700, 16)
  ctx.fillStyle = INK.fg
  const [title] = wrapText(ctx, list.name, right - left - totalW - px(8), 1)
  ctx.fillText(title, left, titleY)
  ctx.font = font(400, 8.5)
  ctx.fillStyle = INK.muted
  const converted = currency !== 'JPY' && Boolean(rates)
  const savedOn = formatDate(Math.floor(list.createdAt / 60000), { year: true })
  // A refreshed list's prices are from its last refresh, not its save.
  const refreshed = list.pricedAt - list.createdAt > 60_000
  const pricedOn = formatDate(Math.floor(list.pricedAt / 60000), { year: true })
  const savedPrices = refreshed ? `prices as refreshed ${pricedOn}` : `prices as saved ${savedOn}`
  // "Today" is the catalog's date, not the clock's: a tab left open, or a
  // scrape running behind, would otherwise date old prices as now.
  const asOf = current ? `prices as of ${formatDate(pricesAt, { year: true })}` : savedPrices
  const conversions = converted ? ', conversions approximate' : ''
  // Unlisted (or unpriced) cards are left out of today's total; say so.
  const unpriced = current ? rows.filter((row) => row.now == null).length : 0
  const metaLine = (source) => {
    if (!priced) return `saved ${savedOn}`
    const parts = [cardsText, copiesText, `${asOf}${source}${conversions}`]
    if (unpriced) parts.push(`${unpriced} not priced today`)
    return parts.join(' · ')
  }
  // The source goes if the line would overrun (the footer names the site).
  let metaText = metaLine(' from yuyu-tei.jp')
  if (ctx.measureText(metaText).width > right - left) metaText = metaLine('')
  ctx.fillText(metaText, left, titleY + pt(15))
  const ruleY = px(MARGIN + HEADER_H) - px(2)
  ctx.fillStyle = INK.line
  ctx.fillRect(left, ruleY, right - left, Math.max(1, px(0.3)))

  // The 2 × 2 grid.
  const gridTop = px(MARGIN + HEADER_H + 2)
  const gridBottom = H - px(MARGIN + FOOTER_H)
  const cellW = (right - left - px(GAP_X)) / 2
  const cellH = (gridBottom - gridTop - px(GAP_Y)) / 2
  const start = page * PER_PAGE
  for (let i = 0; i < PER_PAGE && start + i < rows.length; i++) {
    const box = {
      x: left + (i % 2) * (cellW + px(GAP_X)),
      y: gridTop + Math.floor(i / 2) * (cellH + px(GAP_Y)),
      w: cellW,
      h: cellH,
    }
    drawCard(ctx, rows[start + i], art[start + i], box, info)
  }

  // Watermark: the app mark, faint, over the middle of the page (and so
  // across the inner corners of all four cards), so a printout or a
  // screenshot of one still says where it came from.
  if (logo) {
    const size = px(WATERMARK)
    ctx.save()
    ctx.globalAlpha = WATERMARK_ALPHA
    ctx.drawImage(logo, (W - size) / 2, (gridTop + gridBottom - size) / 2, size, size)
    ctx.restore()
  }

  // Footer: the mark and the app's name and address, then the page.
  const footY = H - px(MARGIN) + px(2)
  let x = left
  if (logo) {
    const size = px(5)
    ctx.drawImage(logo, x, footY - size / 2, size, size)
    x += size + px(2)
  }
  ctx.font = font(700, 8)
  ctx.fillStyle = INK.fg
  ctx.fillText(APP_NAME, x, footY)
  x += ctx.measureText(APP_NAME).width
  ctx.font = font(400, 7.5)
  ctx.fillStyle = INK.subtle
  ctx.fillText(`  ·  ${location.host}`, x, footY)
  ctx.textAlign = 'right'
  ctx.fillText(
    `Exported ${formatDate(Math.floor(Date.now() / 60000), { year: true })} · Page ${page + 1} of ${pageCount}`,
    right,
    footY
  )
  ctx.textAlign = 'left'
}

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject) : reject(new Error('Canvas export failed'))),
      'image/jpeg',
      0.85
    )
  })
}

// --- PDF ---------------------------------------------------------------------

// A PDF text string in UTF-16BE hex, so any title survives.
function pdfText(text) {
  let hex = 'FEFF'
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0')
  return `<${hex}>`
}

// One page per JPEG, each drawn full-bleed on an A4 page.
function buildPdf(pages, title) {
  const enc = new TextEncoder()
  const chunks = []
  const offsets = []
  let length = 0
  const push = (part) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part
    chunks.push(bytes)
    length += bytes.length
  }
  const object = (n, ...parts) => {
    offsets[n] = length
    push(`${n} 0 obj\n`)
    parts.forEach(push)
    push('\nendobj\n')
  }

  push('%PDF-1.4\n')
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  // 1 catalog, 2 page tree, 3 info; then page, content and image per page.
  const pageRef = (i) => 4 + i * 3
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageRef(i)} 0 R`).join(' ')}] >>`)
  object(3, `<< /Title ${pdfText(title)} /Producer (yuyu-tei price tracker) >>`)
  pages.forEach((page, i) => {
    const n = pageRef(i)
    object(
      n,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W_PT} ${PAGE_H_PT}] ` +
        `/Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`
    )
    const content = `q ${PAGE_W_PT} 0 0 ${PAGE_H_PT} 0 0 cm /Im0 Do Q`
    object(n + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
    object(
      n + 2,
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      page.jpeg,
      '\nendstream'
    )
  })

  const count = offsets.length
  const xref = length
  push(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(chunks, { type: 'application/pdf' })
}

/**
 * Builds the PDF for one saved list. `rows` are the sheet's rows (saved
 * item + `card`, `now`), `totals` its sheetTotals(). `prices` is 'now'
 * (today's prices and total, which need the catalog loaded), 'saved' (the
 * prices the list was saved with) or 'none' (cards and copies only);
 * `pricesAt` is the minute today's prices are from (the catalog's).
 * `onProgress(fraction)` reports 0-1: the art downloads, the slow part,
 * take it to ART_SHARE, drawing the pages the rest. Resolves to
 * { blob, missing } -- missing counts cards whose art couldn't be loaded
 * (they print with a blank frame).
 */
export async function buildListPdf({ list, rows, totals, prices, pricesAt, currency, rates, pricesReady, onProgress }) {
  const [art, logo] = await Promise.all([
    loadAllArt(rows, (done, total) => onProgress?.((done / total) * ART_SHARE)),
    loadImage(LOGO_URL),
  ])
  await document.fonts?.ready
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif'
  const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  const font = (weight, size, monospace = false) => `${weight} ${pt(size)}px ${monospace ? mono : family}`

  const canvas = document.createElement('canvas')
  canvas.width = px(PAGE_W_MM)
  canvas.height = px(PAGE_H_MM)
  const ctx = canvas.getContext('2d')
  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE))
  const info = {
    list,
    totals,
    prices,
    pricesAt: pricesAt ?? Math.floor(Date.now() / 60000),
    currency,
    rates,
    pricesReady,
    font,
    logo,
  }
  const pages = []
  for (let page = 0; page < pageCount; page++) {
    drawPage(ctx, rows, art, page, pageCount, info)
    pages.push({ jpeg: await canvasToJpeg(canvas), width: canvas.width, height: canvas.height })
    onProgress?.(ART_SHARE + ((page + 1) / pageCount) * (1 - ART_SHARE))
  }
  return { blob: buildPdf(pages, list.name), missing: art.filter((img) => !img).length }
}
