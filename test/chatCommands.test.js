'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cc = require('../server/services/chatCommands');

test('parseCommand extracts /explain', () => {
  const r = cc.parseCommand('/explain what is condo');
  assert.equal(r.command, '/explain');
  assert.equal(r.intent, 'what is condo');
});

test('parseCommand extracts /analytic with multi-word', () => {
  const r = cc.parseCommand('/analytic china impact overview');
  assert.equal(r.command, '/analytic');
  assert.equal(r.intent, 'china impact overview');
});

test('parseCommand extracts /block', () => {
  const r = cc.parseCommand('/block trade war link');
  assert.equal(r.command, '/block');
  assert.equal(r.intent, 'trade war link');
});

test('parseCommand returns null when no slash prefix', () => {
  const r = cc.parseCommand('what is cap k');
  assert.equal(r.command, null);
  assert.equal(r.intent, 'what is cap k');
});

test('parseCommand handles pasted text on /explain', () => {
  const r = cc.parseCommand('/explain this:\nthe affirmative claims...');
  assert.equal(r.command, '/explain');
  assert.match(r.intent, /affirmative/);
});

test('buildExplainPrompt mentions intent', () => {
  const p = cc.buildExplainPrompt({ intent: 'condo theory' });
  assert.match(p, /condo theory/);
});

test('buildAnalyticPrompt includes analytics refs', () => {
  const p = cc.buildAnalyticPrompt({
    intent: 'x',
    analytics: [{ content_plain: 'snippet' }],
  });
  assert.match(p, /snippet/);
});

test('buildBlockPrompt includes cards', () => {
  const p = cc.buildBlockPrompt({
    intent: 'y',
    cards: [{ id: '1', tag: 'T', shortCite: 'S', body_plain: 'B' }],
    analytics: [],
  });
  assert.match(p, /S/);
  assert.match(p, /T/);
});
