'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldKeepSlashOpen } = require('../public/slash-helpers.js');

test('popup closes once command is fully typed + space', () => {
  assert.equal(shouldKeepSlashOpen('/block ', ['/block', '/blockade']), false);
});
test('popup stays open while typing a prefix', () => {
  assert.equal(shouldKeepSlashOpen('/bl', ['/block']), true);
});
test('popup closes once an exact command typed (no space, only one match)', () => {
  assert.equal(shouldKeepSlashOpen('/clear', ['/clear']), false);
});
test('popup closes with arg text after space', () => {
  assert.equal(shouldKeepSlashOpen('/block crime is bad', ['/block']), false);
});
test('popup closes for non-slash input', () => {
  assert.equal(shouldKeepSlashOpen('hello', ['/block']), false);
});
test('popup closes with no matches', () => {
  assert.equal(shouldKeepSlashOpen('/xyz', []), false);
});
