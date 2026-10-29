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

// Small all-caps heading of a section in the card modal ("Skill", "Price
// history").
export const SECTION_HEADING = 'text-xs font-semibold uppercase tracking-wide text-fg-subtle'

// Heading scale: a view's title (Watchlist, Saved lists, Market movers),
// a titled block within a view (a Movers list), and a dialog's title.
export const PAGE_TITLE = 'text-lg font-bold tracking-tight text-fg'
export const SECTION_TITLE = 'text-base font-semibold text-fg'
export const DIALOG_TITLE = 'text-xl font-bold leading-tight text-fg'

// An inline panel that opens under a view's header (import, export, deck
// import). Borders and fill vary by panel, so they're added by the caller.
export const PANEL = 'mt-3 rounded-lg border p-3 shadow-sm sm:p-4'

// The dimmed page behind a dialog; the caller adds its z-index and layout.
export const BACKDROP = 'fixed inset-0 animate-fade bg-backdrop'

const PILL_VARIANTS = {
  // A quiet fact: "Grade 3", "Power 13000".
  stat: 'bg-surface-2 px-2 py-0.5 font-medium text-fg-muted',
  // A status with a colored outline; the caller adds the colors.
  outline: 'border px-2 py-0.5 font-semibold',
  // A link or button shaped like a pill (Movers' section jumps).
  link: 'min-h-8 shrink-0 gap-1.5 border border-line-strong bg-surface px-3 font-medium text-fg shadow-sm transition hover:border-accent hover:text-accent',
  // An active filter, with room for its remove button (RemovablePill).
  filter: 'gap-0.5 border border-line-strong bg-surface py-0.5 pl-2.5 pr-0.5 font-medium text-fg',
}

/** @param {'stat' | 'outline' | 'link' | 'filter'} variant */
export function pillClass(variant) {
  return `inline-flex items-center gap-1 rounded-full text-xs ${PILL_VARIANTS[variant]}`
}
