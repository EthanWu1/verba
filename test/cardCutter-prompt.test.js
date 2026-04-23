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
test('prompt requires complete-thought highlights with subject+verb+object', () => {
  assert.match(SYSTEM_PROMPT, /complete thought|complete clause|complete sentences?/i);
  assert.match(SYSTEM_PROMPT, /subject \+ verb \+ object|subject,? verb,? (and |&|\+)?object/i);
});
test('prompt contains BAD bulleted-noun-phrase vs GOOD subject+verb example', () => {
  assert.match(SYSTEM_PROMPT, /BAD\b[\s\S]*GOOD\b/);
  assert.match(SYSTEM_PROMPT, /nuclear war/i);
  assert.match(SYSTEM_PROMPT, /causes|leads to|triggers/i);
});
test('prompt demands verb or reject', () => {
  assert.match(SYSTEM_PROMPT, /REJECT|re-?cut|explicit verb/i);
});
