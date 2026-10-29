// Test helper: resolves the theme's CSS color tokens (src/index.css on top
// of Tailwind's default theme) to sRGB and measures WCAG contrast. Knows the
// color syntaxes those files use: #hex, hsl(), oklch(), var() and
// color-mix(in oklab, ...). Colors with alpha come back with `a` < 1.
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** @returns {Map<string, string>} custom property -> raw value, in source order (later wins) */
function declarations(css, map = new Map()) {
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].replace(/\s+/g, ' ').trim())
  return map
}

/** The body of the first `selector { ... }` block (no nesting inside). */
function block(css, selector) {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no ${selector} block`)
  return css.slice(start, css.indexOf('}', start))
}

/** Token maps for each theme: Tailwind defaults, the @theme ramps, then :root (and .dark). */
export function loadThemes() {
  const css = read('../src/index.css')
  const base = declarations(read('../node_modules/tailwindcss/theme.css'))
  declarations(css.slice(0, css.indexOf(':root {')), base)
  const light = declarations(block(css, ':root'), new Map(base))
  const dark = declarations(block(css, '.dark'), new Map(light))
  return { light, dark, css }
}

const clamp = (x) => Math.max(0, Math.min(1, x))
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function hsl(h, s, l) {
  s /= 100
  l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0), f(8), f(4)]
}

function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => fromLinear(clamp(c)))
}

function rgbToOklab(rgb) {
  const [r, g, b] = rgb.map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** Splits on top-level commas. */
function args(str) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of str) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

/**
 * @param {string} value a CSS color, possibly using var() from `tokens`
 * @param {Map<string, string>} tokens
 * @returns {{ rgb: number[], a: number }}
 */
export function resolve(value, tokens) {
  value = value.trim()
  let m
  if ((m = /^var\((--[\w-]+)\)$/.exec(value))) {
    const next = tokens.get(m[1])
    if (next === undefined) throw new Error(`unknown token ${m[1]}`)
    return resolve(next, tokens)
  }
  if (value === 'transparent') return { rgb: [0, 0, 0], a: 0 }
  if (value === 'white') return { rgb: [1, 1, 1], a: 1 }
  if ((m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value))) {
    const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
    return { rgb: [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), a: 1 }
  }
  if ((m = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(value))) {
    return { rgb: hsl(+m[1], +m[2], +m[3]), a: m[4] === undefined ? 1 : +m[4] }
  }
  if ((m = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value))) {
    const h = (+m[3] * Math.PI) / 180
    return { rgb: oklabToRgb([m[1] / 100, +m[2] * Math.cos(h), +m[2] * Math.sin(h)]), a: 1 }
  }
  if ((m = /^color-mix\(in oklab,(.*)\)$/.exec(value))) {
    const [first, second] = args(m[1])
    const [c1, p1] = /^(.*?)\s+([\d.]+)%$/.exec(first).slice(1)
    const a = resolve(c1, tokens)
    const b = resolve(second, tokens)
    const w = p1 / 100
    if (b.a === 0) return { rgb: a.rgb, a: a.a * w }
    const la = rgbToOklab(a.rgb)
    const lb = rgbToOklab(b.rgb)
    return { rgb: oklabToRgb(la.map((x, i) => x * w + lb[i] * (1 - w))), a: a.a * w + b.a * (1 - w) }
  }
  throw new Error(`can't parse color "${value}"`)
}

const luminance = (rgb) => {
  const [r, g, b] = rgb.map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio of two opaque colors. */
export function contrast(a, b) {
  if (a.a < 1 || b.a < 1) throw new Error('contrast needs opaque colors')
  const [hi, lo] = [luminance(a.rgb), luminance(b.rgb)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** "#rrggbb" of an opaque color. */
export function toHex({ rgb }) {
  return `#${rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
}
