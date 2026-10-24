'use strict';

// The pipeline side of the card modal's rules-text translator: building its
// translation memory from official text, and its clan table kept in step
// with nation.js. The translator itself is tested in
// frontend/test/translator.test.js.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { BY_CLAN } = require('../nation');
const { splitEnglishAbilities } = require('../translation-pairs');
const { templateFor } = require('../build-translation-memory');

const TERMS = path.join(__dirname, '..', '..', 'frontend', 'src', 'features', 'card', 'translate', 'terms.js');

let terms;
before(async () => {
  terms = await import(pathToFileURL(TERMS).href);
});

describe('translateTerm', () => {
  it('covers every Japanese clan spelling nation.js recognizes', () => {
    const japanese = [...BY_CLAN.keys()].filter((k) => /[぀-ヿ㐀-鿿]/.test(k));
    const missing = japanese.filter((k) => !Object.hasOwn(terms.CLANS, k));
    assert.deepEqual(missing, []);
  });
});

describe('translation memory building', () => {
  it('splits official English at ability icons, but not inside a granted ability', () => {
    assert.deepEqual(splitEnglishAbilities('[CONT](VC):A. [AUTO]:This unit gets "[AUTO]:B." until end of turn.'), ['[CONT](VC):A.', '[AUTO]:This unit gets "[AUTO]:B." until end of turn.']);
  });

  it('templates a line\'s one name and its power-style numbers', () => {
    assert.equal(templateFor('【永】:「ブラスター」を含むユニットのパワー+5000。', '[CONT]:Your units with "Blaster" in their card names get [Power] +5000.'), '[CONT]:Your units with "{N}" in their card names get [Power] +{#0}.');
    // Two different names can't share one {N}.
    assert.equal(templateFor('「A」と「B」', '"A" and "B"'), null);
  });
});
