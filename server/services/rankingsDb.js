'use strict';

const { getDb } = require('./db');

const PAGE_SIZE = 50;
const MIN_ROUNDS_FOR_BOARD = 10;

function listSeasons() {
  return getDb().prepare(`
    SELECT season, COUNT(DISTINCT teamKey || ':' || eventAbbr) AS ratedCount
    FROM toc_ratings
    GROUP BY season
    ORDER BY season DESC
  `).all();
}

function leaderboard({ season, event, page = 1, q = '', sort = 'rating' }) {
  const db = getDb();
  const offset = Math.max(0, (Number(page) - 1) * PAGE_SIZE);
  const qTrim = String(q || '').trim();
  const base = `
    FROM toc_ratings
    WHERE season = ? AND eventAbbr = ? AND roundCount >= ?
  `;
  const args = [season, event, MIN_ROUNDS_FOR_BOARD];
  let where = '';
  if (qTrim) {
    where = ` AND (LOWER(displayName) LIKE ? OR LOWER(schoolName) LIKE ?)`;
    const like = '%' + qTrim.toLowerCase() + '%';
    args.push(like, like);
  }
  const orderClauses = {
    rating: 'rating DESC',
    wins: 'wins DESC, rating DESC',
    peak: 'peakRating DESC, rating DESC',
    rounds: 'roundCount DESC, rating DESC',
  };
  const orderBy = orderClauses[sort] || orderClauses.rating;
  const totalCount = db.prepare(`SELECT COUNT(*) AS n ${base}${where}`).get(...args).n;
  const rankedCte = `
    WITH ranked AS (
      SELECT teamKey, displayName, schoolName, schoolCode, rating, wins, losses, roundCount, peakRating,
             ROW_NUMBER() OVER (ORDER BY rating DESC) AS rank
      FROM toc_ratings
      WHERE season = ? AND eventAbbr = ? AND roundCount >= ?
    )
  `;
  const rankedArgs = [season, event, MIN_ROUNDS_FOR_BOARD];
  let filter = '';
  if (qTrim) {
    filter = ` WHERE LOWER(displayName) LIKE ? OR LOWER(schoolName) LIKE ?`;
    const like = '%' + qTrim.toLowerCase() + '%';
    rankedArgs.push(like, like);
  }
  const rawRows = db.prepare(`
    ${rankedCte}
    SELECT * FROM ranked
    ${filter}
    ORDER BY rank ASC
    LIMIT ? OFFSET ?
  `).all(...rankedArgs, PAGE_SIZE, offset);

  // Merge rows at the same school where one code is a prefix of another (same lead debater).
  const codeOf = (s) => {
    const m = String(s || '').trim().match(/([A-Z][A-Za-z]{1,4})$/);
    return m ? m[1].toUpperCase() : '';
  };
  const merged = [];
  const used = new Set();
  for (let i = 0; i < rawRows.length; i++) {
    if (used.has(i)) continue;
    const a = { ...rawRows[i] };
    const aCode = codeOf(a.displayName);
    for (let j = i + 1; j < rawRows.length; j++) {
      if (used.has(j)) continue;
      const b = rawRows[j];
      if (!a.schoolName || b.schoolName !== a.schoolName) continue;
      const bCode = codeOf(b.displayName);
      if (!aCode || !bCode) continue;
      if (aCode.startsWith(bCode) || bCode.startsWith(aCode)) {
        a.wins       = (a.wins || 0) + (b.wins || 0);
        a.losses     = (a.losses || 0) + (b.losses || 0);
        a.roundCount = (a.roundCount || 0) + (b.roundCount || 0);
        if ((b.peakRating || 0) > (a.peakRating || 0)) a.peakRating = b.peakRating;
        used.add(j);
      }
    }
    merged.push(a);
  }
  // Keep original ROW_NUMBER rank (absolute) so search / dedup don't renumber.
  return {
    season, event, page: Number(page), pageSize: PAGE_SIZE, totalCount, sort,
    hasMore: rawRows.length >= PAGE_SIZE,
    rows: merged,
  };
}

function rankOf(teamKey, season, event) {
  const r = getDb().prepare(`
    SELECT COUNT(*) + 1 AS rank FROM toc_ratings
    WHERE season = ? AND eventAbbr = ?
      AND rating > (SELECT rating FROM toc_ratings WHERE season = ? AND eventAbbr = ? AND teamKey = ?)
      AND roundCount >= ?
  `).get(season, event, season, event, teamKey, MIN_ROUNDS_FOR_BOARD);
  return r?.rank ?? null;
}

function outOf(season, event) {
  return getDb().prepare(`
    SELECT COUNT(*) AS n FROM toc_ratings
    WHERE season = ? AND eventAbbr = ? AND roundCount >= ?
  `).get(season, event, MIN_ROUNDS_FOR_BOARD).n;
}

function profile(teamKey, season, event) {
  const db = getDb();
  const rating = db.prepare(`
    SELECT * FROM toc_ratings WHERE season = ? AND eventAbbr = ? AND teamKey = ?
  `).get(season, event, teamKey);
  if (!rating) return null;

  // Drive from toc_entries so EVERY tournament the debater entered shows up,
  // not just the ones with paired rating-history rows.
  const tournaments = db.prepare(`
    SELECT t.tourn_id AS tournId, t.name, t.startDate, t.endDate,
           e.entryId, e.earnedBid,
           r.place, r.rank
    FROM toc_entries e
    JOIN toc_tournaments t ON t.tourn_id = e.tournId
    LEFT JOIN toc_results r
      ON r.tournId = e.tournId AND r.eventAbbr = e.eventAbbr AND r.entryId = e.entryId
    WHERE t.season = ? AND e.eventAbbr = ? AND e.teamKey = ?
    ORDER BY t.startDate ASC
  `).all(season, event, teamKey);

  // Prelim vs elim records per tournament, majority-voted across panel ballots.
  const ballotRecs = db.prepare(`
    SELECT b.tournId, b.roundId, b.roundType,
           SUM(CASE WHEN b.result='W' THEN 1 ELSE 0 END) AS w,
           SUM(CASE WHEN b.result='L' THEN 1 ELSE 0 END) AS l
    FROM toc_ballots b
    JOIN toc_entries e ON e.tournId=b.tournId AND e.entryId=b.entryId AND e.eventAbbr=b.eventAbbr
    JOIN toc_tournaments t ON t.tourn_id=b.tournId
    WHERE e.teamKey=? AND b.eventAbbr=? AND t.season=?
    GROUP BY b.tournId, b.roundId, b.roundType
  `).all(teamKey, event, season);
  const recByTourn = new Map();
  let seasonPW = 0, seasonPL = 0, seasonEW = 0, seasonEL = 0;
  for (const r of ballotRecs) {
    if (!recByTourn.has(r.tournId)) recByTourn.set(r.tournId, { prelimWins: 0, prelimLosses: 0, elimWins: 0, elimLosses: 0 });
    const rec = recByTourn.get(r.tournId);
    const isPrelim = r.roundType === 'prelim' || r.roundType === 'highlow';
    if (r.w > r.l) {
      if (isPrelim) { rec.prelimWins++; seasonPW++; }
      else          { rec.elimWins++;   seasonEW++; }
    } else if (r.l > r.w) {
      if (isPrelim) { rec.prelimLosses++; seasonPL++; }
      else          { rec.elimLosses++;   seasonEL++; }
    } else {
      // BYE (no recorded W/L) counts as a win.
      if (isPrelim) { rec.prelimWins++; seasonPW++; }
      else          { rec.elimWins++;   seasonEW++; }
    }
  }
  for (const t of tournaments) {
    const rec = recByTourn.get(t.tournId) || { prelimWins: 0, prelimLosses: 0, elimWins: 0, elimLosses: 0 };
    Object.assign(t, rec);
  }

  const wiki = db.prepare(`
    SELECT w.id, w.fullName FROM wiki_teams w
    WHERE LOWER(w.school) = LOWER(?)
      AND (' ' || LOWER(?) || ' ') LIKE '% ' || LOWER(w.code) || ' %'
    LIMIT 1
  `).get(rating.schoolName || '', rating.displayName || '');

  let topArguments = [];
  if (wiki?.id) {
    topArguments = db.prepare(`
      SELECT id AS argumentId, name, side, readCount
      FROM wiki_arguments WHERE teamId = ?
      ORDER BY readCount DESC LIMIT 5
    `).all(wiki.id);
  }

  const bids = db.prepare(`
    SELECT fullBids, partialBids FROM toc_season_bids
    WHERE season = ? AND eventAbbr = ? AND teamKey = ?
  `).get(season, event, teamKey) || { fullBids: 0, partialBids: 0 };

  const total = outOf(season, event);
  const rank  = rankOf(teamKey, season, event);
  const winPct = (rating.wins + rating.losses) > 0 ? rating.wins / (rating.wins + rating.losses) : 0;

  const avgSpk = db.prepare(`
    SELECT AVG(b.speakerPoints) AS avg, COUNT(b.speakerPoints) AS n
    FROM toc_ballots b
    JOIN toc_entries e ON e.tournId = b.tournId AND e.entryId = b.entryId AND e.eventAbbr = b.eventAbbr
    JOIN toc_tournaments t ON t.tourn_id = b.tournId
    WHERE e.teamKey = ? AND b.eventAbbr = ? AND t.season = ? AND b.speakerPoints IS NOT NULL
  `).get(teamKey, event, season);
  const avgSpeakerPoints = avgSpk && avgSpk.n ? avgSpk.avg : null;

  return {
    teamKey, season, event,
    displayName: rating.displayName, schoolName: rating.schoolName, schoolCode: rating.schoolCode,
    rating: { current: rating.rating, peak: rating.peakRating, avgSpeakerPoints, rank, outOf: total },
    record: {
      wins: rating.wins, losses: rating.losses, winPct, roundCount: rating.roundCount,
      prelimWins: seasonPW, prelimLosses: seasonPL,
      elimWins: seasonEW,   elimLosses: seasonEL,
    },
    bids,
    tournaments,
    topArguments,
    wikiTeamId: wiki?.id || null,
  };
}

function history(teamKey, season, event) {
  return getDb().prepare(`
    SELECT tournId, roundId, roundName, roundType, result,
           ratingBefore, ratingAfter, change, opponentKey, opponentRating, occurredAt
    FROM toc_rating_history
    WHERE season = ? AND eventAbbr = ? AND teamKey = ?
    ORDER BY occurredAt ASC, id ASC
  `).all(season, event, teamKey);
}

module.exports = { listSeasons, leaderboard, profile, history, rankOf, outOf };
