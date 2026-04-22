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
  assert.equal(pickChatMaxTokens('what is uniqueness?'), 220);
  assert.equal(pickChatMaxTokens('explain warrants'), 220);
});

test('SHORT_BRIEF instructs 1–2 sentences', () => {
  assert.match(SHORT_BRIEF, /1[–-]2/);
  assert.match(SHORT_BRIEF, /sentence/i);
});
