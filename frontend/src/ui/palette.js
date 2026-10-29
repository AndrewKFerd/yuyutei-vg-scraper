// The theme's colors as plain hex, for code that can't read the CSS
// variables in index.css: the logo artwork (also public/favicon.svg), the
// banner, the PDF export's canvas and the browser's theme-color. index.css
// stays the source of truth; test/palette-sync.test.js checks these against it.

/** The two brand colors (index.css brand-500 / gold-500). */
export const BRAND_BLUE = '#5195e1'
export const GOLD = '#eecf99'

/** brand-700: the logo tile and filled buttons. */
export const BRAND_700 = '#246bbc'
/** gold-900: dark gold text on gold fills (rarity badges). */
export const GOLD_900 = '#715628'

/** The header's surface in each theme, for <meta name="theme-color">. */
export const THEME_COLOR = { light: '#f3f6f9', dark: '#151e28' }

/**
 * The light theme's text colors, whatever theme the page is in: a PDF is for
 * paper. Lines and fills are paper's own (white page, light gray rules).
 */
export const PAPER_INK = {
  fg: '#0f172b',
  muted: '#45556c',
  subtle: '#566376',
  line: '#e2e8f0',
  fill: '#f1f5f9',
  accent: '#2161ab',
  positive: '#016630',
  negative: '#b83014',
  warning: '#973c00',
}
