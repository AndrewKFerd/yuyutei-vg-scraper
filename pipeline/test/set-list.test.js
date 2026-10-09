'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseSetListFromHtml } = require('../scrape-catalog');

describe('parseSetListFromHtml', () => {
  it('reads the sidebar set list in page order, skipping duplicates and unlabeled entries', () => {
    const html = `
      <li><input type="checkbox" class="versPhone" name="vers[]" value="dzbt17" id="dzbt17VersPhone">
        <label for="dzbt17VersPhone" class="label">[DZBT17]  運命星戦</label></li>
      <li><input type="checkbox" class="versPhone" name="vers[]" value="promo-100" id="promo-100VersPhone" checked>
        <label for="promo-100VersPhone">PR/001〜PR/100</label></li>
      <li><input type="checkbox" class="versPhone" name="vers[]" value="dzbt17" id="dzbt17VersPhone2">
        <label for="dzbt17VersPhone2">duplicate</label></li>
      <li><input type="checkbox" class="versPhone" name="vers[]" value="nolabel" id="nolabelVersPhone"></li>`;
    assert.deepEqual(parseSetListFromHtml(html), [
      { slug: 'dzbt17', label: '[DZBT17] 運命星戦' },
      { slug: 'promo-100', label: 'PR/001〜PR/100' },
    ]);
  });

  it('is empty when the markup is missing', () => {
    assert.deepEqual(parseSetListFromHtml('<html><body>no sidebar</body></html>'), []);
  });
});
