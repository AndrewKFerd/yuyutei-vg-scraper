'use strict';

const cheerio = require('cheerio');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function buildUrl(set) {
  return `https://yuyu-tei.jp/sell/vg/s/${encodeURIComponent(set)}`;
}

function parsePrice(text) {
  if (!text) return null;
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits) return null;
  return parseInt(digits, 10);
}

function parseStock(text) {
  if (!text) return 0;
  if (/×|品切れ|売り切れ/.test(text)) return 0;
  const match = text.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function extractIdFromUrl(url) {
  if (!url) return null;
  const parts = url.split('/').filter(Boolean);
  return parts[parts.length - 1] || null;
}

/** Best-effort cleanup of the JSON-LD breadcrumb's last item name into a bare set name. */
function cleanSetName(raw) {
  if (!raw) return '';
  let s = raw;
  // Strip a leading bracketed code, e.g. "[DZBT16] "
  s = s.replace(/^\s*\[[^\]]*\]\s*/, '');
  // Strip common trailing boilerplate after a separator.
  s = s.split(/[|｜]/)[0];
  s = s.replace(/シングルカード販売.*$/, '');
  return s.trim();
}

function extractSetNameFromPage($) {
  // Try JSON-LD BreadcrumbList first.
  const ldScripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < ldScripts.length; i++) {
    const raw = $(ldScripts[i]).contents().text();
    if (!raw) continue;
    try {
      const json = JSON.parse(raw);
      const candidates = Array.isArray(json) ? json : [json];
      for (const node of candidates) {
        if (node && node['@type'] === 'BreadcrumbList' && Array.isArray(node.itemListElement)) {
          const last = node.itemListElement[node.itemListElement.length - 1];
          const name = last && (last.name || (last.item && last.item.name));
          if (name) {
            const cleaned = cleanSetName(name);
            if (cleaned) return cleaned;
          }
        }
      }
    } catch (err) {
      // not valid JSON, or not the breadcrumb — ignore and keep looking
    }
  }

  // Fall back to <title>.
  const title = $('title').text();
  if (title) {
    const cleaned = cleanSetName(title.split(/[|｜]/)[0]);
    if (cleaned) return cleaned;
  }

  return '';
}

/**
 * Scrape a single set's sell listing page.
 * Returns { setNameJp, cards: [{ id, setCode, rarity, nameJp, price, priceDisplay, stock, imageUrl, detailUrl }] }
 */
async function scrapeSet(set) {
  const url = buildUrl(set);
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const setNameJp = extractSetNameFromPage($);

  const cards = [];

  $('div.cards-list').each((_, section) => {
    const $section = $(section);
    const headingText = $section.find('h3').first().text().trim();
    const headingRarityMatch = headingText.match(/^(\S+)/);
    const headingRarity = headingRarityMatch ? headingRarityMatch[1] : '';

    $section.find('div.card-product').each((__, el) => {
      const $card = $(el);

      const img = $card.find('img.card').first();
      const imageUrl = img.attr('src') || '';
      const alt = img.attr('alt') || '';
      const altParts = alt.trim().split(/\s+/);
      const altRarity = altParts.length > 1 ? altParts[1] : '';

      const detailLink = $card.find('a[href*="/sell/vg/card/"]').first().attr('href') || '';
      const id = extractIdFromUrl(detailLink) || extractIdFromUrl(imageUrl.replace(/\.jpg.*$/, ''));

      const setCode = $card
        .find('span.border.border-dark')
        .first()
        .text()
        .trim();

      const nameJp = $card.find('h4.text-primary.fw-bold').first().text().trim();

      const priceText = $card.find('strong').first().text().trim();
      const price = parsePrice(priceText);
      const priceDisplay = price !== null ? `¥${price.toLocaleString('en-US')}` : priceText || null;

      const stockText = $card.find('label.cart_sell_zaiko').first().text().trim();
      const stock = parseStock(stockText);

      const rarity = altRarity || headingRarity || '';

      if (!id) return; // skip anything we can't identify

      cards.push({
        id,
        setCode,
        rarity,
        nameJp,
        price,
        priceDisplay,
        stock,
        imageUrl,
        detailUrl: detailLink,
      });
    });
  });

  // Fallback: if the page structure doesn't group cards under div.cards-list,
  // scan the whole document for div.card-product directly.
  if (cards.length === 0) {
    $('div.card-product').each((_, el) => {
      const $card = $(el);
      const img = $card.find('img.card').first();
      const imageUrl = img.attr('src') || '';
      const alt = img.attr('alt') || '';
      const altParts = alt.trim().split(/\s+/);
      const altRarity = altParts.length > 1 ? altParts[1] : '';

      const detailLink = $card.find('a[href*="/sell/vg/card/"]').first().attr('href') || '';
      const id = extractIdFromUrl(detailLink) || extractIdFromUrl(imageUrl.replace(/\.jpg.*$/, ''));

      const setCode = $card.find('span.border.border-dark').first().text().trim();
      const nameJp = $card.find('h4.text-primary.fw-bold').first().text().trim();
      const priceText = $card.find('strong').first().text().trim();
      const price = parsePrice(priceText);
      const priceDisplay = price !== null ? `¥${price.toLocaleString('en-US')}` : priceText || null;
      const stockText = $card.find('label.cart_sell_zaiko').first().text().trim();
      const stock = parseStock(stockText);

      if (!id) return;

      cards.push({
        id,
        setCode,
        rarity: altRarity,
        nameJp,
        price,
        priceDisplay,
        stock,
        imageUrl,
        detailUrl: detailLink,
      });
    });
  }

  return { setNameJp, cards };
}

module.exports = { scrapeSet, buildUrl, parsePrice, parseStock, cleanSetName };
