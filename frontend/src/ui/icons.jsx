// One icon set for the whole app: 20px grid, 1.75px round strokes in
// currentColor, so icons take their color from the text around them and
// match each other. Decorative by default (aria-hidden): the control that
// holds an icon carries the accessible name.

const PATHS = {
  close: <path d="M5.5 5.5l9 9m0-9l-9 9" />,
  search: (
    <>
      <circle cx="8.75" cy="8.75" r="5.25" />
      <path d="M12.75 12.75l3.75 3.75" />
    </>
  ),
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  check: <path d="M4.5 10.5l3.5 3.5 7.5-8" />,
  chevronLeft: <path d="M12 5l-5 5 5 5" />,
  chevronRight: <path d="M8 5l5 5-5 5" />,
  chevronDown: <path d="M5.5 8l4.5 4.5L14.5 8" />,
  filter: <path d="M3.5 6h13M6 10h8M8.5 14h3" />,
  refresh: (
    <>
      <path d="M15.5 9a5.75 5.75 0 00-10.4-2.6" />
      <path d="M4.5 11a5.75 5.75 0 0010.4 2.6" />
      <path d="M4.75 3.25v3.5h3.5M15.25 16.75v-3.5h-3.5" />
    </>
  ),
  trendUp: <path d="M3 14l4.5-4.5 3 3L17 6m-4.5 0H17v4.5" />,
  trendDown: <path d="M3 6l4.5 4.5 3-3L17 14m-4.5 0H17V9.5" />,
  soldOut: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M5.5 5.5l9 9" />
    </>
  ),
  restock: (
    <>
      <path d="M4 10a6 6 0 0110.6-3.85" />
      <path d="M16 10a6 6 0 01-10.6 3.85" />
      <path d="M15 3v3.5h-3.5M5 17v-3.5h3.5" />
    </>
  ),
  bolt: <path d="M11 2.5L4.5 11h5l-1 6.5L15 9h-5l1-6.5z" />,
  eye: (
    <>
      <path d="M2.5 10s2.75-5.25 7.5-5.25S17.5 10 17.5 10s-2.75 5.25-7.5 5.25S2.5 10 2.5 10z" />
      <circle cx="10" cy="10" r="2.25" />
    </>
  ),
  layers: (
    <>
      <path d="M10 3.5l6.5 3.25L10 10 3.5 6.75 10 3.5z" />
      <path d="M3.5 10.25L10 13.5l6.5-3.25M3.5 13.5L10 16.75l6.5-3.25" />
    </>
  ),
  expand: <path d="M12 3.5h4.5V8M8 16.5H3.5V12M16.5 3.5L11.5 8.5M3.5 16.5l5-5" />,
  external: <path d="M8.5 4.5h-4v11h11v-4M11.5 3.5h5v5M16.5 3.5l-7 7" />,
  sun: (
    <>
      <circle cx="10" cy="10" r="3.25" />
      <path d="M10 2.5v1.5M10 16v1.5M2.5 10H4M16 10h1.5M4.7 4.7l1.06 1.06M14.24 14.24l1.06 1.06M4.7 15.3l1.06-1.06M14.24 5.76l1.06-1.06" />
    </>
  ),
  moon: <path d="M16 12.6A6.5 6.5 0 017.4 4a6.5 6.5 0 108.6 8.6z" />,
  // A small round bell (the kind on a ribbon), for watching a card.
  bell: (
    <>
      <path d="M5 13.5h10c-.9-1-1.4-2.4-1.4-4V8.6a3.6 3.6 0 00-7.2 0v.9c0 1.6-.5 3-1.4 4z" />
      <path d="M8.4 15.8a1.7 1.7 0 003.2 0M10 3.2V5" />
    </>
  ),
  // A paw print: the watchlist's empty state and the banner's trail.
  paw: (
    <>
      <path d="M10 10.5c-2.3 0-4.2 2-4.2 3.9 0 1.2.9 1.9 2 1.9.9 0 1.4-.4 2.2-.4s1.3.4 2.2.4c1.1 0 2-.7 2-1.9 0-1.9-1.9-3.9-4.2-3.9z" />
      <circle cx="5.2" cy="8.6" r="1.4" />
      <circle cx="8.1" cy="5.6" r="1.4" />
      <circle cx="11.9" cy="5.6" r="1.4" />
      <circle cx="14.8" cy="8.6" r="1.4" />
    </>
  ),
  // A monitor: the theme follows the device.
  system: (
    <>
      <rect x="3" y="4" width="14" height="9.5" rx="1.5" />
      <path d="M7.5 16.5h5M10 13.5v3" />
    </>
  ),
  table: (
    <>
      <rect x="3.25" y="4" width="13.5" height="12" rx="1.5" />
      <path d="M3.25 8h13.5M3.25 12h13.5M8 8v8" />
    </>
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="6.75" />
      <path d="M10 9v4.5M10 6.5v.01" />
    </>
  ),
  upload: <path d="M10 12.5V3.5M6.5 7L10 3.5 13.5 7M3.5 12.5v2.5a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5v-2.5" />,
  download: <path d="M10 3.5v9M6.5 9l3.5 3.5L13.5 9M3.5 12.5v2.5a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5v-2.5" />,
  copy: (
    <>
      <rect x="7" y="7" width="9.5" height="9.5" rx="1.5" />
      <path d="M13 7V5a1.5 1.5 0 00-1.5-1.5H5A1.5 1.5 0 003.5 5v6.5A1.5 1.5 0 005 13h2" />
    </>
  ),
  share: (
    <>
      <circle cx="14.5" cy="5" r="2" />
      <circle cx="5.5" cy="10" r="2" />
      <circle cx="14.5" cy="15" r="2" />
      <path d="M7.3 9l5.4-3M7.3 11l5.4 3" />
    </>
  ),
}

export default function Icon({ name, className = 'h-5 w-5', ...rest }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}
