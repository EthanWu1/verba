'use strict';

const K_BASE_ELIM = {
  Triples:  35,
  Doubles:  45,
  Octas:    60,
  Quarters: 75,
  Semis:    90,
  Finals:   120,
};

const K_MULT_BY_BID = {
  Triples:  1.00,
  Doubles:  0.90,
  Octas:    0.75,
  Quarters: 0.60,
  Semis:    0.45,
  Finals:   0.30,
};

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function kBase(roundType, depth) {
  if (roundType === 'prelim') return 20;
  if (roundType === 'elim')   return K_BASE_ELIM[depth] ?? 60;
  return 20;
}

function kMult(bidLevel) {
  return K_MULT_BY_BID[bidLevel] ?? 0.20;
}

function applyElo({ ratingA, ratingB, winner, roundType, depth, bidLevel }) {
  const K = kBase(roundType, depth) * kMult(bidLevel);
  const expA = expectedScore(ratingA, ratingB);
  const expB = 1 - expA;
  const scoreA = winner === 'A' ? 1 : 0;
  const scoreB = 1 - scoreA;
  const rawDeltaA = K * (scoreA - expA);
  const rawDeltaB = K * (scoreB - expB);
  if (roundType === 'elim') {
    return {
      deltaA: winner === 'A' ? rawDeltaA : 0,
      deltaB: winner === 'B' ? rawDeltaB : 0,
    };
  }
  return { deltaA: rawDeltaA, deltaB: rawDeltaB };
}

function aggregateBallotsToResult(ballots) {
  let w = 0, l = 0;
  for (const b of (ballots || [])) {
    if (b.result === 'W') w++;
    else if (b.result === 'L') l++;
  }
  if (w === 0 && l === 0) return null;
  if (w === l) return null;
  return w > l ? 'W' : 'L';
}

const ELIM_LABELS = new Set(['Triples', 'Doubles', 'Octas', 'Quarters', 'Semis', 'Finals']);
const COUNT_TO_DEPTH = { 64: 'Triples', 32: 'Doubles', 16: 'Octas', 8: 'Quarters', 4: 'Semis', 2: 'Finals' };

function inferElimDepth(roundName, uniqueEntryCount) {
  if (roundName && ELIM_LABELS.has(roundName)) return roundName;
  if (COUNT_TO_DEPTH[uniqueEntryCount]) return COUNT_TO_DEPTH[uniqueEntryCount];
  return null;
}

module.exports = {
  expectedScore,
  kBase,
  kMult,
  applyElo,
  aggregateBallotsToResult,
  inferElimDepth,
};
