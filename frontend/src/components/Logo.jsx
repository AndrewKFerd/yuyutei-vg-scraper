import Icon from './icons'

// The app mark: a gold card with a rising price line on the brand blue.
// Same artwork as public/favicon.svg -- keep the two in step. `animated`
// plays it as a loading indicator (keyframes in index.css); the class hooks
// and pathLength don't change how the static mark draws.
function Logo({ className = '', animated = false }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={`${animated ? 'logo-animated' : ''} ${className}`}
    >
      <rect width="32" height="32" rx="8" fill="#246fbd" />
      <rect className="logo-back" x="8.5" y="6" width="13" height="18" rx="2" transform="rotate(-10 15 15)" fill="none" stroke="#eecf99" strokeWidth="1.5" opacity="0.55" />
      <g className="logo-front" transform="rotate(6 17.5 17)">
        <rect x="11" y="8" width="13" height="18" rx="2" fill="#eecf99" />
        <path className="logo-line" pathLength="1" d="M13.5 21.5l3-3.5 2.5 2 3.5-5" fill="none" stroke="#246fbd" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  )
}

/**
 * The mark, large and faint, under a state's icon: the empty and error
 * states' "nothing here" picture, so the brand shows where there's no
 * content to compete with (never behind card art).
 */
export function EmptyMark({ icon }) {
  return (
    <div aria-hidden="true" className="relative flex h-20 w-20 items-center justify-center">
      <Logo className="absolute inset-0 h-full w-full opacity-10 dark:opacity-20" />
      {icon && <Icon name={icon} className="relative h-8 w-8 text-fg-muted" />}
    </div>
  )
}

export default Logo
