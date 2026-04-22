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

const { updateItem, removeItem, setActive, clearAll } = carousel;

test('updateItem merges patch by id', () => {
  let s = pushItem(createState(), { id: 'a', status: 'cutting' });
  s = updateItem(s, 'a', { status: 'done', tag: 'hello' });
  assert.equal(s.items[0].status, 'done');
  assert.equal(s.items[0].tag, 'hello');
});

test('updateItem is no-op for unknown id', () => {
  const s1 = pushItem(createState(), { id: 'a' });
  const s2 = updateItem(s1, 'missing', { tag: 'x' });
  assert.equal(s2.items[0].tag, '');
});

test('removeItem splices by id and clamps activeIndex', () => {
  let s = pushItem(createState(), { id: 'a' });
  s = pushItem(s, { id: 'b' });
  s = pushItem(s, { id: 'c' });
  // activeIndex is 2 (c). remove b (index 1).
  s = removeItem(s, 'b');
  assert.equal(s.items.length, 2);
  assert.deepEqual(s.items.map(i => i.id), ['a','c']);
  assert.equal(s.activeIndex, 1); // still points at c (now index 1)
});

test('removeItem clamps activeIndex when removing active last', () => {
  let s = pushItem(createState(), { id: 'a' });
  s = pushItem(s, { id: 'b' });
  s = removeItem(s, 'b'); // active was 1, now only 1 item
  assert.equal(s.activeIndex, 0);
});

test('setActive clamps to valid range', () => {
  let s = pushItem(createState(), { id: 'a' });
  s = pushItem(s, { id: 'b' });
  assert.equal(setActive(s, 99).activeIndex, 1);
  assert.equal(setActive(s, -5).activeIndex, 0);
  assert.equal(setActive(s, 0).activeIndex, 0);
});

test('clearAll empties and zeros activeIndex', () => {
  let s = pushItem(createState(), { id: 'a' });
  s = pushItem(s, { id: 'b' });
  s = clearAll(s);
  assert.equal(s.items.length, 0);
  assert.equal(s.activeIndex, 0);
});

const { serialize, deserialize, hydrate, SOFT_CAP_ITEMS } = carousel;

test('serialize strips ephemeral fields', () => {
  let s = pushItem(createState(), {
    id: 'a', status: 'cutting', phase: 'x', phaseHistory: ['p1'], error: null
  });
  const json = serialize(s);
  const parsed = JSON.parse(json);
  assert.equal(parsed.items[0].id, 'a');
  assert.equal(parsed.items[0].tag, '');
  assert.equal(parsed.items[0].phase, null);
  assert.equal(parsed.items[0].phaseHistory.length, 0);
  assert.equal(parsed.items[0].error, null);
});

test('deserialize reconstructs state with ephemeral fields zeroed', () => {
  const json = JSON.stringify({
    items: [{ id: 'a', status: 'done', tag: '', cite: '', body_html: '',
              body_markdown: '', body_plain: '', createdAt: 1, sourceUrl: null, sourceLabel: null }],
    activeIndex: 0
  });
  const s = deserialize(json);
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].phase, null);
  assert.deepEqual(s.items[0].phaseHistory, []);
});

test('hydrate converts cutting → error (interrupted)', () => {
  const json = JSON.stringify({
    items: [{ id: 'a', status: 'cutting', tag: '', cite: '', body_html: '',
              body_markdown: '', body_plain: '', createdAt: 1, sourceUrl: null, sourceLabel: null }],
    activeIndex: 0
  });
  const s = hydrate(json);
  assert.equal(s.items[0].status, 'error');
  assert.match(s.items[0].error, /interrupted/i);
});

test('hydrate returns empty state on invalid json', () => {
  assert.deepEqual(hydrate('not json').items, []);
  assert.deepEqual(hydrate('').items, []);
  assert.deepEqual(hydrate(null).items, []);
});

test('pushItem evicts oldest done when over SOFT_CAP_ITEMS', () => {
  let s = createState();
  for (let i = 0; i < SOFT_CAP_ITEMS + 5; i++) {
    s = pushItem(s, { id: String(i), status: 'done' });
  }
  assert.equal(s.items.length, SOFT_CAP_ITEMS);
  assert.equal(s.items[0].id, '5');
  assert.equal(s.activeIndex, SOFT_CAP_ITEMS - 1);
});
