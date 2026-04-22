'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const carousel = require('../public/lib/carousel.js');

test('carousel module exports required API', () => {
  ['createState','pushItem','updateItem','removeItem','setActive','clearAll',
   'serialize','deserialize','hydrate','SOFT_CAP_ITEMS','SOFT_CAP_BYTES']
    .forEach(name => assert.ok(name in carousel, `missing export: ${name}`));
});

const { createState, pushItem } = carousel;

test('pushItem appends and sets activeIndex to last', () => {
  let s = createState();
  s = pushItem(s, { id: 'a', status: 'done', tag: 'A' });
  s = pushItem(s, { id: 'b', status: 'cutting' });
  assert.equal(s.items.length, 2);
  assert.equal(s.items[0].id, 'a');
  assert.equal(s.items[1].id, 'b');
  assert.equal(s.activeIndex, 1);
});

test('pushItem returns new state (immutable)', () => {
  const a = createState();
  const b = pushItem(a, { id: 'x', status: 'done' });
  assert.notStrictEqual(a, b);
  assert.equal(a.items.length, 0);
  assert.equal(b.items.length, 1);
});

test('pushItem fills default fields', () => {
  const s = pushItem(createState(), { id: 'a', status: 'done' });
  assert.equal(typeof s.items[0].createdAt, 'number');
  assert.equal(s.items[0].tag, '');
  assert.equal(s.items[0].cite, '');
  assert.equal(s.items[0].body_html, '');
  assert.equal(s.items[0].phaseHistory.length, 0);
});
