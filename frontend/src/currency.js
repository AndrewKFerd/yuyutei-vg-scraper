// Card prices on yuyu-tei are all in JPY. This converts that base price into
// whichever of a small supported set the user picks, using live rates with a
// graceful offline/failure fallback — same "best effort, never break the
// page" philosophy as the translation engine on the data-pipeline side.

export const CURRENCIES = ['JPY', 'USD', 'SGD', 'IDR']

const RATES_URL = 'https://open.er-api.com/v6/latest/JPY'
const STORAGE_KEY = 'yuyutei:jpyRates'
const CACHE_TTL_MS = 12 * 60 * 60 * 1000 // 12h — exchange rates don't need to be fresher than that here

// Approximate fallback rates (JPY -> currency), used only if the live fetch
// fails and there's no usable cache. Rough, occasionally-stale numbers are
// fine here — this is a fan tool showing an estimate, not a payment system.
const FALLBACK_RATES = { JPY: 1, USD: 0.0067, SGD: 0.0087, IDR: 105 }

function readCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.fetchedAt !== 'number' || !parsed.rates) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(rates) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rates, fetchedAt: Date.now() }))
  } catch {
    // Private browsing / storage disabled — fine, we just won't cache.
  }
}

/**
 * Resolves to a { JPY: 1, USD, SGD, IDR } rate table. Tries a fresh cache
 * first, then a live fetch, then a stale cache, then the hardcoded
 * fallback — in that order, never rejecting.
 */
export async function getRates() {
  const cached = readCache()
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rates
  }

  try {
    const res = await fetch(RATES_URL)
    if (!res.ok) throw new Error(`rates endpoint returned HTTP ${res.status}`)
    const data = await res.json()
    const rates = {
      JPY: 1,
      USD: data.rates?.USD,
      SGD: data.rates?.SGD,
      IDR: data.rates?.IDR,
    }
    if (!rates.USD || !rates.SGD || !rates.IDR) throw new Error('malformed rates response')
    writeCache(rates)
    return rates
  } catch (err) {
    console.warn(`[currency] Live rate fetch failed (${err.message}); using ${cached ? 'stale cached' : 'hardcoded fallback'} rates.`)
    return cached ? cached.rates : FALLBACK_RATES
  }
}

// Explicit symbols rather than Intl's `style: 'currency'` — its ICU data
// renders SGD with a bare "$" in most locales, indistinguishable from USD,
// which defeats the point of a multi-currency selector. Plain decimal
// formatting + a hardcoded prefix sidesteps that ambiguity entirely.
const SYMBOLS = { JPY: '¥', USD: '$', SGD: 'S$', IDR: 'Rp ' }
const FRACTION_DIGITS = { JPY: 0, USD: 2, SGD: 2, IDR: 0 }

function numberFormatter(currency) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: FRACTION_DIGITS[currency] ?? 2,
    maximumFractionDigits: FRACTION_DIGITS[currency] ?? 2,
  })
}

const FORMATTERS = Object.fromEntries(CURRENCIES.map((c) => [c, numberFormatter(c)]))

/** Converts a JPY price into `currency` and formats it, e.g. "S$656.51". */
export function formatPrice(priceJpy, currency, rates) {
  if (priceJpy == null) return '—'

  const rate = currency !== 'JPY' && rates ? rates[currency] : null
  const targetCurrency = rate ? currency : 'JPY'
  const amount = rate ? priceJpy * rate : priceJpy

  return `${SYMBOLS[targetCurrency]}${FORMATTERS[targetCurrency].format(amount)}`
}
