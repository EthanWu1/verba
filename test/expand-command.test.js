'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { expandCommand } = require('../public/slash-helpers.js');

test('/block returns display + expanded send', () => {
  const r = expandCommand('/block', 'nuclear deterrence');
  assert.equal(r.action, 'send');
  assert.equal(r.display, '/block nuclear deterrence');
  assert.match(r.send, /Write a block on: nuclear deterrence/);
  assert.notEqual(r.display, r.send);
});

test('/explain returns display + expanded send', () => {
  const r = expandCommand('/explain', 'util framework');
  assert.equal(r.action, 'send');
  assert.equal(r.display, '/explain util framework');
  assert.match(r.send, /Explain: util framework/);
});

test('/clear returns clear action', () => {
  const r = expandCommand('/clear', '');
  assert.equal(r.action, 'clear');
});

test('/find returns find action with arg', () => {
  const r = expandCommand('/find', 'Korsgaard');
  assert.equal(r.action, 'find');
  assert.equal(r.arg, 'Korsgaard');
});

test('/block without arg returns action=prefill', () => {
  const r = expandCommand('/block', '');
  assert.equal(r.action, 'prefill');
  assert.equal(r.prefill, '/block ');
});

test('unknown command returns null', () => {
  assert.equal(expandCommand('/bogus', ''), null);
});
