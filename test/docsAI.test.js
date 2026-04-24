'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ai = require('../server/services/docsAI');

test('buildBlockPrompt includes intent, headings, cards, analytics', () => {
  const prompt = ai.buildBlockPrompt({
    intent: 'China DA uniqueness',
    headings: { h1: 'Case', h2: 'Scenario', h3: 'Link' },
    cards:    [{ tag: 'X', shortCite: 'Smith 24', body_plain: 'hi', argumentTypes: ['policy'], argumentTags: ['china'] }],
    analytics:[{ title: 'Overview', content_plain: 'China rising' }],
  });
  assert.match(prompt, /China DA uniqueness/);
  assert.match(prompt, /Case/);
  assert.match(prompt, /Scenario/);
  assert.match(prompt, /Link/);
  assert.match(prompt, /Smith 24/);
  assert.match(prompt, /China rising/);
});

test('buildAnalyticPrompt includes intent and analytics refs', () => {
  const prompt = ai.buildAnalyticPrompt({
    intent: 'impact calc',
    headings: { h1: 'Case' },
    analytics: [{ content_plain: 'magnitude first' }],
  });
  assert.match(prompt, /impact calc/);
  assert.match(prompt, /magnitude first/);
  assert.match(prompt, /Case/);
});

test('retrieveCards returns array (may be empty without DB matches)', async () => {
  const rows = await ai.retrieveCards('debate', 3);
  assert.ok(Array.isArray(rows));
});

test('retrieveAnalytics returns array', async () => {
  const rows = await ai.retrieveAnalytics('debate', 3);
  assert.ok(Array.isArray(rows));
});
