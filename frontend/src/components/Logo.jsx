// The app mark: a gold card with a rising price line on the brand blue.
// Same artwork as public/favicon.svg -- keep the two in step.
function Logo({ className = '' }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <rect width="32" height="32" rx="8" fill="#246fbd" />
      <rect x="8.5" y="6" width="13" height="18" rx="2" transform="rotate(-10 15 15)" fill="none" stroke="#eecf99" strokeWidth="1.5" opacity="0.55" />
      <g transform="rotate(6 17.5 17)">
        <rect x="11" y="8" width="13" height="18" rx="2" fill="#eecf99" />
        <path d="M13.5 21.5l3-3.5 2.5 2 3.5-5" fill="none" stroke="#246fbd" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  )
}

export default Logo
