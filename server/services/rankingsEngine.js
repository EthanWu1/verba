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

// ── Orchestration ────────────────────────────────────────────

function recomputeRatings(season) {
  const { getDb } = require('./db');
  const db = getDb();

  const ballots = db.prepare(`
    SELECT b.id AS ballotId, b.tournId, b.eventAbbr, b.roundId, b.roundName, b.roundType,
           b.entryId, b.opponentEntryId, b.result,
           e.teamKey, e.displayName, e.schoolName, e.schoolCode,
           t.startDate, te.bidLevel
    FROM toc_ballots b
    JOIN toc_tournaments t ON t.tourn_id = b.tournId
    JOIN toc_entries e     ON e.tournId = b.tournId AND e.entryId = b.entryId
    JOIN toc_tournament_events te ON te.tournId = b.tournId AND te.abbr = b.eventAbbr
    WHERE t.season = ? AND b.eventAbbr IN ('LD','PF','CX')
      AND EXISTS (
        SELECT 1 FROM toc_tournament_events te2
        WHERE te2.tournId = b.tournId AND te2.abbr = b.eventAbbr
          AND te2.bidLevel IS NOT NULL
      )
    ORDER BY t.startDate ASC,
             CASE b.roundType WHEN 'prelim' THEN 0 ELSE 1 END ASC,
             CASE WHEN b.roundName GLOB '[0-9]*' THEN CAST(b.roundName AS INTEGER) ELSE 9999 END ASC,
             b.roundName ASC, b.tournId ASC, b.roundId ASC
  `).all(season);

  const perEntry = new Map();
  for (const row of ballots) {
    const key = `${row.tournId}:${row.eventAbbr}:${row.roundId}:${row.entryId}`;
    let g = perEntry.get(key);
    if (!g) {
      g = {
        tournId: row.tournId, eventAbbr: row.eventAbbr,
        roundId: row.roundId, roundName: row.roundName, roundType: row.roundType,
        entryId: row.entryId, teamKey: row.teamKey,
        displayName: row.displayName, schoolName: row.schoolName, schoolCode: row.schoolCode,
        startDate: row.startDate, bidLevel: row.bidLevel,
        ballots: [],
      };
      perEntry.set(key, g);
    }
    g.ballots.push({ result: row.result, opponentEntryId: row.opponentEntryId });
  }

  const entriesPerRound = new Map();
  for (const g of perEntry.values()) {
    const k = `${g.tournId}:${g.eventAbbr}:${g.roundId}`;
    if (!entriesPerRound.has(k)) entriesPerRound.set(k, new Set());
    entriesPerRound.get(k).add(g.entryId);
  }

  const matchesByRound = new Map();
  const processed = new Set();
  for (const [key, g] of perEntry.entries()) {
    if (processed.has(key)) continue;
    const result = aggregateBallotsToResult(g.ballots);
    if (!result) { processed.add(key); continue; }
    const oppEntry = g.ballots.find(b => b.opponentEntryId)?.opponentEntryId;
    if (!oppEntry) { processed.add(key); continue; }
    const oppKey = `${g.tournId}:${g.eventAbbr}:${g.roundId}:${oppEntry}`;
    const opp = perEntry.get(oppKey);
    if (!opp) { processed.add(key); continue; }
    const oppResult = aggregateBallotsToResult(opp.ballots);
    if (!oppResult) { processed.add(key); processed.add(oppKey); continue; }
    const winner = result === 'W' ? 'A' : 'B';
    const roundKey = `${g.tournId}:${g.eventAbbr}:${g.roundId}`;
    if (!matchesByRound.has(roundKey)) matchesByRound.set(roundKey, []);
    matchesByRound.get(roundKey).push({ A: g, B: opp, winner, roundKey });
    processed.add(key); processed.add(oppKey);
  }

  const orderedRoundKeys = [...matchesByRound.keys()].sort((a, b) => {
    const ma = matchesByRound.get(a)[0];
    const mb = matchesByRound.get(b)[0];
    if (ma.A.startDate !== mb.A.startDate) return ma.A.startDate < mb.A.startDate ? -1 : 1;
    const aPrelim = ma.A.roundType === 'prelim' ? 0 : 1;
    const bPrelim = mb.A.roundType === 'prelim' ? 0 : 1;
    if (aPrelim !== bPrelim) return aPrelim - bPrelim;
    const an = Number(ma.A.roundName); const bn = Number(mb.A.roundName);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
    return String(ma.A.roundName || '').localeCompare(String(mb.A.roundName || ''));
  });

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM toc_rating_history WHERE season = ?`).run(season);
    db.prepare(`DELETE FROM toc_ratings WHERE season = ?`).run(season);

    const state = new Map();
    function getState(eventAbbr, teamKey, meta) {
      const k = `${eventAbbr}::${teamKey}`;
      let s = state.get(k);
      if (!s) {
        s = { rating: 1500, roundCount: 0, wins: 0, losses: 0, peak: 1500,
              displayName: meta.displayName, schoolName: meta.schoolName, schoolCode: meta.schoolCode,
              eventAbbr, teamKey };
        state.set(k, s);
      } else {
        if (meta.displayName) s.displayName = meta.displayName;
        if (meta.schoolName)  s.schoolName  = meta.schoolName;
        if (meta.schoolCode)  s.schoolCode  = meta.schoolCode;
      }
      return s;
    }

    const insertHist = db.prepare(`
      INSERT INTO toc_rating_history
        (season, eventAbbr, teamKey, tournId, roundId, roundName, roundType,
         result, ratingBefore, ratingAfter, change, opponentKey, opponentRating, occurredAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const roundKey of orderedRoundKeys) {
      const matches = matchesByRound.get(roundKey);
      for (const m of matches) {
        const { A, B, winner } = m;
        const uniqEntries = entriesPerRound.get(roundKey)?.size || 0;
        const depth = A.roundType === 'elim' ? inferElimDepth(A.roundName, uniqEntries) : null;

        const sA = getState(A.eventAbbr, A.teamKey, { displayName: A.displayName, schoolName: A.schoolName, schoolCode: A.schoolCode });
        const sB = getState(B.eventAbbr, B.teamKey, { displayName: B.displayName, schoolName: B.schoolName, schoolCode: B.schoolCode });

        const { deltaA, deltaB } = applyElo({
          ratingA: sA.rating, ratingB: sB.rating, winner,
          roundType: A.roundType, depth, bidLevel: A.bidLevel,
        });

        const beforeA = sA.rating, beforeB = sB.rating;
        sA.rating += deltaA;
        sB.rating += deltaB;
        sA.peak = Math.max(sA.peak, sA.rating);
        sB.peak = Math.max(sB.peak, sB.rating);
        sA.roundCount++; sB.roundCount++;
        const aResult = winner === 'A' ? 'W' : 'L';
        const bResult = winner === 'B' ? 'W' : 'L';
        if (aResult === 'W') sA.wins++; else sA.losses++;
        if (bResult === 'W') sB.wins++; else sB.losses++;

        insertHist.run(
          season, A.eventAbbr, A.teamKey, A.tournId, A.roundId, A.roundName, A.roundType,
          aResult, beforeA, sA.rating, deltaA, B.teamKey, beforeB, A.startDate,
        );
        insertHist.run(
          season, B.eventAbbr, B.teamKey, B.tournId, B.roundId, B.roundName, B.roundType,
          bResult, beforeB, sB.rating, deltaB, A.teamKey, beforeA, A.startDate,
        );
      }
    }

    const nowIso = new Date().toISOString();
    const insertRating = db.prepare(`
      INSERT INTO toc_ratings
        (season, eventAbbr, teamKey, displayName, schoolName, schoolCode,
         rating, roundCount, wins, losses, peakRating, lastUpdated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const s of state.values()) {
      insertRating.run(
        season, s.eventAbbr, s.teamKey,
        s.displayName || null, s.schoolName || null, s.schoolCode || null,
        s.rating, s.roundCount, s.wins, s.losses, s.peak, nowIso,
      );
    }
  });
  tx();
}

module.exports = {
  expectedScore,
  kBase,
  kMult,
  applyElo,
  aggregateBallotsToResult,
  inferElimDepth,
  recomputeRatings,
};
