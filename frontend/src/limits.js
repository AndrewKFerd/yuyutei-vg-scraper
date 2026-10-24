// Limits and value checks shared by the price list (useCalculator.js) and
// saved lists. No React or browser APIs here, so the pipeline tests can
// import the saved-list modules that build on it.

export const MAX_ITEMS = 300
export const MAX_QTY = 99

export const clampQty = (n) => Math.min(MAX_QTY, Math.max(1, Math.round(Number(n)) || 1))
export const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export const strOrNull = (v) => (typeof v === 'string' && v ? v : null)
