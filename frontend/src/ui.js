// Class recipes shared by components/controls.jsx and the few places that
// style a non-button element (a link, a <summary>) like a control.

// Pill text field / select surface. Text fields get a soft focus ring;
// everything else uses the global :focus-visible outline.
export const FIELD =
  'h-10 rounded-full border border-line-strong bg-surface text-sm text-fg shadow-sm outline-none transition placeholder:text-fg-subtle focus:border-accent focus:ring-4 focus:ring-ring'

const BUTTON_VARIANTS = {
  primary: 'bg-accent-solid font-semibold text-on-accent shadow-sm hover:bg-accent-solid-hover',
  secondary: 'border border-line-strong bg-surface font-medium text-fg shadow-sm hover:border-accent hover:text-accent',
  ghost: 'font-medium text-fg-muted hover:bg-surface-2 hover:text-fg',
  link: 'font-semibold text-accent underline-offset-2 hover:underline',
  danger: 'font-medium text-negative underline-offset-2 hover:underline',
}

const BUTTON_SIZES = {
  sm: 'min-h-8 px-3 text-xs',
  md: 'min-h-10 px-4 text-sm',
  // Inline text links: no padding, but a 32px-tall hit area that doesn't
  // change the line height.
  inline: '-my-2 min-h-8 py-2 text-xs',
}

export function buttonClass(variant = 'secondary', size = 'md') {
  return `inline-flex items-center justify-center gap-1.5 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]}`
}

// One content width for every band of the page (header, toolbar, grids,
// section headings), so their edges line up at any screen size.
export const CONTAINER = 'mx-auto w-full max-w-screen-2xl px-4 sm:px-6'

// The card grid, shared by search results, set sections, Movers and the
// loading skeleton.
export const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
