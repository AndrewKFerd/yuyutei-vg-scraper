'use strict';

/**
 * Shared HTTP helper for the scraper scripts: browser-like headers plus a
 * minimal in-memory cookie jar, so a scrape session looks like one
 * continuous browser visit rather than a fresh anonymous client on every
 * request.
 *
 * Why this exists: running scrape-catalog.js from a GitHub Actions runner,
 * the first couple of yuyu-tei requests succeeded and then every request
 * from page 3 onward got a hard HTTP 403. That "a couple of clean requests,
 * then a wall" pattern is a common WAF/anti-bot signature -- one plausible
 * cause is that the server sets a cookie on the first response and expects
 * it echoed back on the next request; a client that never sends any cookie
 * back at all (which is what a bare per-request fetch() does) looks
 * anomalous after a short grace period. This is a best-effort mitigation,
 * not a guarantee: if the real defense is a JS/proof-of-work challenge (a
 * full Cloudflare "Managed Challenge") or an outright ASN/IP-range block,
 * no amount of header/cookie tweaking from a plain fetch() will get past
 * it, and that would need a different approach entirely (a real browser
 * engine, or not running from a shared cloud IP at all).
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/** A tiny cookie jar: absorbs Set-Cookie from responses, replays them on later requests. */
function createCookieJar() {
  const jar = new Map();

  return {
    header() {
      if (jar.size === 0) return undefined;
      return Array.from(jar.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
    },
    absorb(res) {
      // Node's fetch (undici) exposes every Set-Cookie header via
      // getSetCookie() (Node 18.14+/20+); fall back to a single get() on
      // anything older so this never throws.
      const raw =
        typeof res.headers.getSetCookie === 'function'
          ? res.headers.getSetCookie()
          : [res.headers.get('set-cookie')].filter(Boolean);
      for (const cookieStr of raw) {
        const [pair] = cookieStr.split(';');
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (name) jar.set(name, value);
      }
    },
  };
}

/**
 * Headers for one request in a simulated browser navigation.
 * @param {{cookie?: string, referer?: string}} opts
 */
function browserHeaders({ cookie, referer } = {}) {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
  if (cookie) headers.Cookie = cookie;
  if (referer) headers.Referer = referer;
  return headers;
}

/**
 * One GET request, done as a plain browser-style navigation would: sends
 * the jar's accumulated cookies and a Referer, absorbs any new cookies from
 * the response. Throws on a non-OK status (caller handles retry logic).
 */
async function browserGet(url, jar, referer) {
  const res = await fetch(url, { headers: browserHeaders({ cookie: jar.header(), referer }) });
  jar.absorb(res);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

module.exports = { USER_AGENT, createCookieJar, browserHeaders, browserGet };
