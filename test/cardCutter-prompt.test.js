'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SYSTEM_PROMPT } = require('../server/prompts/cardCutter');

test('prompt demands cohesive subject+verb+object in stitched highlights', () => {
  assert.match(SYSTEM_PROMPT, /subject/i);
  assert.match(SYSTEM_PROMPT, /COHERENT|COHESIVE/);
});
test('prompt allows partial-word highlights', () => {
  assert.match(SYSTEM_PROMPT, /partial[- ]word|sub[- ]word|inside a word|mid[- ]word|middle of a word/i);
});
test('prompt still enforces PARAGRAPH INTEGRITY', () => {
  assert.match(SYSTEM_PROMPT, /PARAGRAPH INTEGRITY/);
});
test('prompt emphasizes efficiency / shorter spans', () => {
  assert.match(SYSTEM_PROMPT, /EFFICIENCY|shortest/i);
});
