/** Whether the visitor asked for less motion (no smooth scrolls or view cross-fades). */
export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
