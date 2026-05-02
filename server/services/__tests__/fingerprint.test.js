'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loosenedFingerprint, loosenedShortCite, groupKey } = require('../fingerprint');

// The whole point of this module: cosmetic differences in body or cite must
// NOT produce different group keys. These are the variants that previously
// caused the "20 of the same card" prod symptom.

test('loosenedFingerprint: smart vs straight quotes collapse', () => {
  const a = loosenedFingerprint('“Smith argued that…”');
  const b = loosenedFingerprint('"Smith argued that..."');
  assert.equal(a, b);
});

test('loosenedFingerprint: em-dash vs hyphen collapse', () => {
  assert.equal(
    loosenedFingerprint('A — B — C'),
    loosenedFingerprint('A - B - C'),
  );
});

test('loosenedFingerprint: NFC vs NFD diacritics collapse', () => {
  assert.equal(
    loosenedFingerprint('café'),
    loosenedFingerprint('café'),
  );
});

test('loosenedFingerprint: extra punctuation/whitespace collapses', () => {
  const a = loosenedFingerprint('Hello, world. (2024)');
  const b = loosenedFingerprint('hello world 2024');
  assert.equal(a, b);
});

test('loosenedFingerprint: distinct words DO differ', () => {
  assert.notEqual(
    loosenedFingerprint('cats are great'),
    loosenedFingerprint('dogs are great'),
  );
});

test('loosenedShortCite: regex form normalizes to "smith 24"', () => {
  assert.equal(loosenedShortCite("Smith '24"),    'smith 24');
  assert.equal(loosenedShortCite('Smith 2024'),   'smith 24');
  assert.equal(loosenedShortCite('Smith, J 2024'), 'smith 24');
});

test('loosenedShortCite: punctuation/case variants of same author cluster', () => {
  const a = loosenedShortCite('Smith, John, "Title", 2024');
  const b = loosenedShortCite('Smith John 2024');
  assert.equal(a, b);
});

test('groupKey: importer + migration agree on the same card', () => {
  // Simulates a card that, pre-fix, would have been TWO groups: one from
  // the importer (strict shortCite + byte-exact body hash) and one from
  // the migration (loosened). Both call sites share fingerprint.js now,
  // so the key MUST be identical.
  const importerStyle = groupKey({
    body_plain: 'The court ruled — in 2024 — that…',
    cite: "Smith '24",
    shortCite: "Smith '24",
  });
  const migrationStyle = groupKey({
    body_plain: 'The court ruled - in 2024 - that...',
    cite: 'Smith, J. 2024',
    shortCite: '',
  });
  assert.ok(importerStyle.length > 0);
  assert.equal(importerStyle, migrationStyle);
});

test('groupKey: empty inputs produce empty key (caller must skip)', () => {
  assert.equal(groupKey({ body_plain: '',  cite: '' }), '');
  assert.equal(groupKey({ body_plain: 'x', cite: ''  }), '');
});
