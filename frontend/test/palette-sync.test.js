// src/ui/palette.js repeats theme colors for code that can't read CSS
// variables; these checks keep it, the favicon and the theme-color metas in
// step with src/index.css.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadThemes, resolve, toHex } from './color.js'
import { BRAND_700, BRAND_BLUE, GOLD, GOLD_900, PAPER_INK, THEME_COLOR } from '../src/ui/palette.js'

const { light, dark } = loadThemes()
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const hexOf = (value, tokens = light) => toHex(resolve(value, tokens))

describe('palette.js', () => {
  it('matches the index.css ramps', () => {
    assert.equal(BRAND_BLUE, hexOf('var(--color-brand-500)'))
    assert.equal(GOLD, hexOf('var(--color-gold-500)'))
    assert.equal(BRAND_700, hexOf('var(--color-brand-700)'))
    assert.equal(GOLD_900, hexOf('var(--color-gold-900)'))
  })

  it("keeps the PDF's ink equal to the light theme's tokens", () => {
    const tokenOf = { fg: 'fg', muted: 'fg-muted', subtle: 'fg-subtle', accent: 'accent' }
    for (const [key, token] of Object.entries(tokenOf)) {
      assert.equal(PAPER_INK[key], hexOf(`var(--${token})`), key)
    }
    for (const key of ['positive', 'negative', 'warning']) assert.equal(PAPER_INK[key], hexOf(`var(--${key})`), key)
  })

  it('gives theme-color the header surface of each theme', () => {
    assert.equal(THEME_COLOR.light, hexOf('var(--surface)', light))
    assert.equal(THEME_COLOR.dark, hexOf('var(--surface)', dark))
  })
})

describe('copies outside src/', () => {
  it('favicon.svg uses the logo colors', () => {
    const svg = read('../public/favicon.svg').toLowerCase()
    assert.ok(svg.includes(BRAND_700), 'brand-700 tile')
    assert.ok(svg.includes(GOLD), 'gold card')
  })

  it('index.html and theme-init.js use the theme-color values', () => {
    for (const file of ['../index.html', '../public/theme-init.js']) {
      const text = read(file).toLowerCase()
      assert.ok(text.includes(THEME_COLOR.light), `${file}: light`)
      assert.ok(text.includes(THEME_COLOR.dark), `${file}: dark`)
    }
  })
})
