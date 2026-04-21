'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { snapToWordBoundaries } = require('../public/lib/wordSnap.js');

test('mid-word start snaps to word start', () => {
  const t = 'The quick brown fox';
  //         0123456789012345678
  const r = snapToWordBoundaries(t, 5, 9);
  assert.deepEqual(r, { start: 4, end: 9 });
});

test('mid-word end snaps to word end', () => {
  const t = 'The quick brown fox';
  const r = snapToWordBoundaries(t, 4, 7);
  assert.deepEqual(r, { start: 4, end: 9 });
});

test('already at word boundaries unchanged', () => {
  const t = 'The quick brown fox';
  const r = snapToWordBoundaries(t, 4, 9);
  assert.deepEqual(r, { start: 4, end: 9 });
});

test('both endpoints snap outward', () => {
  const t = 'hello world there';
  const r = snapToWordBoundaries(t, 2, 8);
  assert.deepEqual(r, { start: 0, end: 11 });
});

test('trailing space included in input is trimmed to word end', () => {
  const t = 'hello world';
  const r = snapToWordBoundaries(t, 0, 6);
  assert.deepEqual(r, { start: 0, end: 5 });
});

test('leading space is trimmed to next word start', () => {
  const t = 'hello world';
  const r = snapToWordBoundaries(t, 5, 11);
  assert.deepEqual(r, { start: 6, end: 11 });
});

test('punctuation not part of word', () => {
  const t = 'Hello, world!';
  const r = snapToWordBoundaries(t, 2, 10);
  assert.deepEqual(r, { start: 0, end: 12 });
});

test('apostrophe stays in word', () => {
  const t = "don't stop";
  const r = snapToWordBoundaries(t, 1, 4);
  assert.deepEqual(r, { start: 0, end: 5 });
});

test('empty selection returns zero-length at snapped position', () => {
  const t = 'hello world';
  const r = snapToWordBoundaries(t, 3, 3);
  assert.deepEqual(r, { start: 3, end: 3 });
});

test('swapped range is normalized', () => {
  const t = 'hello world';
  const r = snapToWordBoundaries(t, 8, 2);
  assert.deepEqual(r, { start: 0, end: 11 });
});
