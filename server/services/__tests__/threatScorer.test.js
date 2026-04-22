'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scoreEntries } = require('../threatScorer');

test('scoreEntries returns sorted desc by hybrid score, capped at 30', () => {
  const entries = Array.from({ length: 50 }, (_, i) => ({
    entryId: i + 1,
    teamKey: 'T' + i,
    seasonBids: 50 - i,
    recentPlacements: [{ place: i + 1, bidLevel: 'Octas' }],
  }));
  const out = scoreEntries(entries, '2025-2026');
  assert.equal(out.length, 30);
  assert.ok(out[0].score >= out[1].score);
  assert.equal(out[0].entryId, 1);
});

test('scoreEntries handles empty placements gracefully', () => {
  const entries = [
    { entryId: 1, teamKey: 'A', seasonBids: 5, recentPlacements: [] },
    { entryId: 2, teamKey: 'B', seasonBids: 2, recentPlacements: [] },
  ];
  const out = scoreEntries(entries, '2025-2026');
  assert.equal(out[0].entryId, 1);
  assert.equal(out[1].entryId, 2);
});

test('scoreEntries returns empty array for empty input', () => {
  assert.deepEqual(scoreEntries([], '2025-2026'), []);
});

test('scoreEntries respects optional cap parameter', () => {
  const entries = Array.from({ length: 50 }, (_, i) => ({
    entryId: i + 1, teamKey: 'T' + i, seasonBids: 50 - i, recentPlacements: [],
  }));
  assert.equal(scoreEntries(entries, '2025-2026', 10).length, 10);
});
