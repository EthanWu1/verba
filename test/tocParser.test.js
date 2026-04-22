'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { seasonFor, fnv1a, teamKeyFor, inferBidLevel, parseBallots } = require('../server/services/tocParser');

test('seasonFor August 2025 → 2025-26', () => {
  assert.strictEqual(seasonFor('2025-08-15'), '2025-26');
});

test('seasonFor February 2026 → 2025-26', () => {
  assert.strictEqual(seasonFor('2026-02-10'), '2025-26');
});

test('seasonFor June 2026 → 2025-26', () => {
  assert.strictEqual(seasonFor('2026-06-01'), '2025-26');
});

test('seasonFor July 2026 → 2026-27', () => {
  assert.strictEqual(seasonFor('2026-07-01'), '2026-27');
});

test('fnv1a is deterministic hex', () => {
  assert.strictEqual(fnv1a('hello'), fnv1a('hello'));
  assert.match(fnv1a('hello'), /^[0-9a-f]{1,8}$/);
  assert.notStrictEqual(fnv1a('hello'), fnv1a('world'));
});

test('teamKeyFor uses schoolId + sorted student ids', () => {
  const k = teamKeyFor({ students: ['3','1','2'] }, { id: 797828 });
  assert.strictEqual(k, '797828:1,2,3');
});

test('teamKeyFor falls back to hashed school name when schoolId missing', () => {
  const k = teamKeyFor({ students: ['5'] }, { id: null, name: 'Greenhill' });
  assert.match(k, /^h:[0-9a-f]+:5$/);
});

test('inferBidLevel maps full bid count → round name', () => {
  const make = (n) => ({ result_sets: [{ label: 'TOC Qualifying Bids',
    results: Array.from({ length: n }, () => ({ values: [{ value: 'Full' }] })) }] });
  assert.deepStrictEqual(inferBidLevel(make(16)), { bidLevel: 'Octas', fullBids: 16, partialBids: 0 });
  assert.deepStrictEqual(inferBidLevel(make(8)), { bidLevel: 'Quarters', fullBids: 8, partialBids: 0 });
  assert.deepStrictEqual(inferBidLevel(make(4)), { bidLevel: 'Semis', fullBids: 4, partialBids: 0 });
  assert.deepStrictEqual(inferBidLevel(make(2)), { bidLevel: 'Finals', fullBids: 2, partialBids: 0 });
  assert.deepStrictEqual(inferBidLevel(make(0)), { bidLevel: null, fullBids: 0, partialBids: 0 });
});

test('inferBidLevel returns zero when no bid result_set present', () => {
  assert.deepStrictEqual(inferBidLevel({ result_sets: [{ label: 'Final Places', results: [] }] }), { bidLevel: null, fullBids: 0, partialBids: 0 });
});

test('parseBallots extracts pairings with opponent + result', () => {
  const event = { rounds: [{
    id: 1, name: '1', type: 'prelim',
    sections: [{ id: 10, ballots: [
      { id: 100, entry: 5, side: 1, judge_first: 'A', judge_last: 'Smith', scores: [{ tag: 'winloss', value: 1 }, { tag: 'point', value: 28.5 }] },
      { id: 101, entry: 6, side: 2, judge_first: 'A', judge_last: 'Smith', scores: [{ tag: 'winloss', value: 0 }, { tag: 'point', value: 27.0 }] },
    ]}],
  }]};
  const rows = parseBallots(event);
  assert.strictEqual(rows.length, 2);
  const a = rows.find(r => r.entryId === 5);
  assert.strictEqual(a.opponentEntryId, 6);
  assert.strictEqual(a.side, 'aff');
  assert.strictEqual(a.result, 'W');
  assert.strictEqual(a.speakerPoints, 28.5);
  assert.strictEqual(a.judgeName, 'A Smith');
  assert.strictEqual(a.roundName, '1');
  assert.strictEqual(a.roundType, 'prelim');
});

test('parseBallots handles bye (one ballot in section)', () => {
  const event = { rounds: [{
    id: 2, name: '2', type: 'prelim',
    sections: [{ id: 20, ballots: [
      { id: 200, entry: 7, side: 1, judge_first: '', judge_last: '', scores: [{ tag: 'winloss', value: 1 }] },
    ]}],
  }]};
  const rows = parseBallots(event);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].opponentEntryId, null);
  assert.strictEqual(rows[0].result, 'W');
});

test('teamKeyFor falls back to entry.id when students array is empty', () => {
  const a = teamKeyFor({ students: [], id: 42 }, { id: 797828 });
  const b = teamKeyFor({ students: [], id: 43 }, { id: 797828 });
  assert.strictEqual(a, '797828:e42');
  assert.notStrictEqual(a, b);
});

test('teamKeyFor falls back to hashed entry.code when both students and id missing', () => {
  const k = teamKeyFor({ students: [], code: 'Foo AB' }, { id: 797828 });
  assert.match(k, /^797828:ec:[0-9a-f]+$/);
});
