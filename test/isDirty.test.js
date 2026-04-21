'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isDirty } = require('../public/lib/isDirty.js');

test('identical shallow objects are not dirty', () => {
  assert.equal(isDirty({ a: 1, b: 'x' }, { a: 1, b: 'x' }), false);
});

test('differing value is dirty', () => {
  assert.equal(isDirty({ a: 1 }, { a: 2 }), true);
});

test('added key is dirty', () => {
  assert.equal(isDirty({ a: 1, b: 2 }, { a: 1 }), true);
});

test('removed key is dirty', () => {
  assert.equal(isDirty({ a: 1 }, { a: 1, b: 2 }), true);
});

test('undefined equals missing', () => {
  assert.equal(isDirty({ a: 1, b: undefined }, { a: 1 }), false);
});

test('null is not undefined', () => {
  assert.equal(isDirty({ a: null }, { a: undefined }), true);
});

test('empty objects equal', () => {
  assert.equal(isDirty({}, {}), false);
});

test('boolean toggle dirty', () => {
  assert.equal(isDirty({ flag: true }, { flag: false }), true);
});

test('string mismatch dirty', () => {
  assert.equal(isDirty({ hl: 'yellow' }, { hl: 'lilac' }), true);
});

test('number type vs string dirty', () => {
  assert.equal(isDirty({ n: 1 }, { n: '1' }), true);
});
