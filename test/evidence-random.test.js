'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getLibraryCards } = require('../server/services/libraryQuery');

test('getLibraryCards sort=random honors limit', async () => {
  const out = await getLibraryCards({ limit: 50, sort: 'random', randomSeed: 7 });
  assert.ok(Array.isArray(out.items));
  assert.ok(out.items.length <= 50);
});

test('getLibraryCards sort=random with different seeds returns different first id', async () => {
  const a = await getLibraryCards({ limit: 50, sort: 'random', randomSeed: 3 });
  const b = await getLibraryCards({ limit: 50, sort: 'random', randomSeed: 9999991 });
  if (!a.items.length || !b.items.length) return; // empty DB guard
  assert.notEqual(a.items[0].id, b.items[0].id);
});

test('getLibraryCards sort=random with same seed is deterministic', async () => {
  const a = await getLibraryCards({ limit: 20, sort: 'random', randomSeed: 42 });
  const b = await getLibraryCards({ limit: 20, sort: 'random', randomSeed: 42 });
  const ids = (x) => x.items.map(i => i.id).join(',');
  assert.equal(ids(a), ids(b));
});

test('getLibraryCards sort=random paginates without duplicates', async () => {
  const p1 = await getLibraryCards({ limit: 50, page: 1, sort: 'random', randomSeed: 13 });
  const p2 = await getLibraryCards({ limit: 50, page: 2, sort: 'random', randomSeed: 13 });
  const ids1 = new Set(p1.items.map(i => i.id));
  for (const c of p2.items) assert.ok(!ids1.has(c.id), `duplicate id ${c.id}`);
});
