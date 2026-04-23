'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  expectedScore,
  kBase,
  kMult,
  applyElo,
  aggregateBallotsToResult,
  inferElimDepth,
} = require('../server/services/rankingsEngine');

test('expectedScore equal ratings = 0.5', () => {
  assert.strictEqual(expectedScore(1500, 1500), 0.5);
});

test('expectedScore 400 higher ≈ 0.909', () => {
  assert.ok(Math.abs(expectedScore(1900, 1500) - 0.909) < 0.01);
});

test('kBase prelim = 20', () => {
  assert.strictEqual(kBase('prelim', null), 20);
});

test('kBase elim by depth', () => {
  assert.strictEqual(kBase('elim', 'Triples'), 35);
  assert.strictEqual(kBase('elim', 'Doubles'), 45);
  assert.strictEqual(kBase('elim', 'Octos'), 60);
  assert.strictEqual(kBase('elim', 'Quarters'), 75);
  assert.strictEqual(kBase('elim', 'Semis'), 90);
  assert.strictEqual(kBase('elim', 'Finals'), 120);
});

test('kBase elim unknown depth falls back to Octos (60)', () => {
  assert.strictEqual(kBase('elim', null), 60);
  assert.strictEqual(kBase('elim', 'Gibberish'), 60);
});

test('kMult by bidLevel', () => {
  assert.strictEqual(kMult('Triples'), 1.0);
  assert.strictEqual(kMult('Doubles'), 0.9);
  assert.strictEqual(kMult('Octos'), 0.75);
  assert.strictEqual(kMult('Quarters'), 0.6);
  assert.strictEqual(kMult('Semis'), 0.45);
  assert.strictEqual(kMult('Finals'), 0.3);
  assert.strictEqual(kMult(null), 0.2);
  assert.strictEqual(kMult('Unknown'), 0.2);
});

test('applyElo prelim W: both sides update (zero-sum)', () => {
  const { deltaA, deltaB } = applyElo({ ratingA: 1500, ratingB: 1500, winner: 'A', roundType: 'prelim', depth: null, bidLevel: 'Octos' });
  assert.ok(Math.abs(deltaA - 7.5) < 0.01);
  assert.ok(Math.abs(deltaB + 7.5) < 0.01);
});

test('applyElo elim W: only winner gains (asymmetric)', () => {
  const { deltaA, deltaB } = applyElo({ ratingA: 1500, ratingB: 1500, winner: 'A', roundType: 'elim', depth: 'Octos', bidLevel: 'Octos' });
  assert.ok(Math.abs(deltaA - 22.5) < 0.01);
  assert.strictEqual(deltaB, 0);
});

test('applyElo elim L: no penalty for loser', () => {
  const { deltaA, deltaB } = applyElo({ ratingA: 1500, ratingB: 1500, winner: 'B', roundType: 'elim', depth: 'Semis', bidLevel: 'Doubles' });
  assert.ok(Math.abs(deltaB - 40.5) < 0.01);
  assert.strictEqual(deltaA, 0);
});

test('applyElo elim upset: loser unchanged, winner gains a lot', () => {
  const { deltaA, deltaB } = applyElo({ ratingA: 1400, ratingB: 1900, winner: 'A', roundType: 'elim', depth: 'Finals', bidLevel: 'Triples' });
  assert.ok(deltaA > 100);
  assert.strictEqual(deltaB, 0);
});

test('aggregateBallotsToResult majority rule', () => {
  assert.strictEqual(aggregateBallotsToResult([{ result: 'W' }, { result: 'W' }, { result: 'L' }]), 'W');
  assert.strictEqual(aggregateBallotsToResult([{ result: 'L' }, { result: 'L' }, { result: 'W' }]), 'L');
  assert.strictEqual(aggregateBallotsToResult([{ result: 'W' }]), 'W');
});

test('aggregateBallotsToResult returns null on tie or no W/L', () => {
  assert.strictEqual(aggregateBallotsToResult([{ result: 'W' }, { result: 'L' }]), null);
  assert.strictEqual(aggregateBallotsToResult([{ result: null }]), null);
  assert.strictEqual(aggregateBallotsToResult([]), null);
});

test('inferElimDepth from roundName labels', () => {
  assert.strictEqual(inferElimDepth('Finals', 2), 'Finals');
  assert.strictEqual(inferElimDepth('Semis', 4), 'Semis');
  assert.strictEqual(inferElimDepth('Quarters', 8), 'Quarters');
  assert.strictEqual(inferElimDepth('Octos', 16), 'Octos');
  assert.strictEqual(inferElimDepth('Doubles', 32), 'Doubles');
  assert.strictEqual(inferElimDepth('Triples', 64), 'Triples');
});

test('inferElimDepth from entry count when label unknown', () => {
  assert.strictEqual(inferElimDepth('Round 1', 16), 'Octos');
  assert.strictEqual(inferElimDepth('', 8), 'Quarters');
  assert.strictEqual(inferElimDepth('Playoff', 2), 'Finals');
});

test('inferElimDepth returns null when depth cannot be derived', () => {
  assert.strictEqual(inferElimDepth('X', 7), null);
});
