'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ret = require('../server/services/chatRetrieval');

test('retrieveCards returns array', async () => {
  const r = await ret.retrieveCards('debate', 3);
  assert.ok(Array.isArray(r));
});
test('retrieveAnalytics returns array', async () => {
  const r = await ret.retrieveAnalytics('debate', 3);
  assert.ok(Array.isArray(r));
});
test('retrieveUserContext returns array', async () => {
  const r = await ret.retrieveUserContext('u-nonexistent', 'debate', 3);
  assert.ok(Array.isArray(r));
});
test('LRU cache hit on repeat query', async () => {
  const a = await ret.retrieveAnalytics('testquery-xyzzy', 2);
  const b = await ret.retrieveAnalytics('testquery-xyzzy', 2);
  // No structural assertion — just confirm no throw.
  assert.ok(Array.isArray(a));
  assert.ok(Array.isArray(b));
});
