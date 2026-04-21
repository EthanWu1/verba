'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { wordAt } = require('../public/lib/wordSnap.js');

test('returns word bounds at index inside word', () => {
  assert.deepEqual(wordAt('hello world', 2), { start: 0, end: 5 });
});

test('returns next word when index on space', () => {
  assert.deepEqual(wordAt('hello world', 5), { start: 6, end: 11 });
});

test('index at word start returns that word', () => {
  assert.deepEqual(wordAt('hello world', 6), { start: 6, end: 11 });
});

test('apostrophe word', () => {
  assert.deepEqual(wordAt("don't stop", 2), { start: 0, end: 5 });
});

test('punctuation returns adjacent word', () => {
  assert.deepEqual(wordAt('Hi, world!', 2), { start: 4, end: 9 });
});
