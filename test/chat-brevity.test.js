'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickChatMaxTokens, SHORT_BRIEF } = require('../server/prompts/chatBrevity');

test('block intent → long token budget', () => {
  assert.equal(pickChatMaxTokens('write a block on Korsgaard'), 1500);
  assert.equal(pickChatMaxTokens('write block against util'), 1500);
  assert.equal(pickChatMaxTokens('give me a frontline'), 1500);
});

test('plain question → short budget', () => {
  assert.equal(pickChatMaxTokens('what is uniqueness?'), 450);
  assert.equal(pickChatMaxTokens('explain warrants'), 450);
});

test('SHORT_BRIEF instructs ≤4 sentences', () => {
  assert.match(SHORT_BRIEF, /4/);
  assert.match(SHORT_BRIEF, /sentence/i);
});
