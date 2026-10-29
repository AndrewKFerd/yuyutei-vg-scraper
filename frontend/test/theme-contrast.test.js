// The theme's text/background pairs (src/index.css) clear WCAG AA in both
// light and dark mode, so a token change can't quietly drop below it.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contrast, loadThemes, resolve } from './color.js'

const { light, dark } = loadThemes()

// [text, background, minimum ratio]
const PAIRS = [
  ...['fg', 'fg-muted', 'fg-subtle', 'accent', 'accent-2', 'positive', 'negative', 'warning'].flatMap((fg) => [
    [fg, 'bg', 4.5],
    [fg, 'surface', 4.5],
  ]),
  ['fg', 'surface-2', 4.5],
  ['fg-muted', 'surface-2', 4.5],
  ['fg-subtle', 'surface-2', 4.5],
  ['accent', 'accent-soft', 4.5],
  ['on-accent', 'accent-solid', 4.5],
  ['on-accent', 'accent-solid-hover', 4.5],
  ['on-accent-2', 'accent-2-solid', 4.5],
  ['on-accent-2', 'accent-2-solid-hover', 4.5],
  ['accent-2', 'accent-2-soft', 4.5],
  ['fg', 'accent-2-soft', 4.5],
  ['positive', 'positive-soft', 4.5],
  ['negative', 'negative-soft', 4.5],
  ['fg', 'warning-soft', 4.5],
  ['fg', 'highlight', 4.5],
  // Control borders are non-text UI: 3:1.
  ['line-strong', 'bg', 3],
  ['line-strong', 'surface', 3],
]

const color = (tokens, name) => resolve(`var(--${name})`, tokens)

for (const [theme, tokens] of [
  ['light', light],
  ['dark', dark],
]) {
  describe(`${theme} theme contrast`, () => {
    for (const [fg, bg, min] of PAIRS) {
      it(`${fg} on ${bg} >= ${min}:1`, () => {
        const ratio = contrast(color(tokens, fg), color(tokens, bg))
        assert.ok(ratio >= min, `${fg} on ${bg}: ${ratio.toFixed(2)}:1`)
      })
    }

    it('white on the solid price chips >= 4.5:1', () => {
      const white = resolve('#fff', tokens)
      for (const solid of ['positive-solid', 'negative-solid']) {
        const ratio = contrast(white, color(tokens, solid))
        assert.ok(ratio >= 4.5, `white on ${solid}: ${ratio.toFixed(2)}:1`)
      }
    })
  })
}

describe('rarity badges', () => {
  const source = readFileSync(new URL('../src/ui/RarityBadge.jsx', import.meta.url), 'utf8')
  const styles = [...source.matchAll(/'bg-([\w-]+?) text-([\w-]+?)'/g)]

  it('finds every badge style', () => assert.ok(styles.length >= 9, `found ${styles.length}`))

  for (const [, bg, fg] of styles) {
    it(`${fg} on ${bg} >= 4.5:1`, () => {
      const named = (name) => (name === 'white' ? '#fff' : `var(--color-${name})`)
      const ratio = contrast(resolve(named(fg), light), resolve(named(bg), light))
      assert.ok(ratio >= 4.5, `${fg} on ${bg}: ${ratio.toFixed(2)}:1`)
    })
  }
})
