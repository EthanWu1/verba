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
  const rows = db.prepare(`
    ${rankedCte}
    SELECT * FROM ranked
    ${filter}
    ORDER BY rank ASC
    LIMIT ? OFFSET ?
  `).all(...rankedArgs, PAGE_SIZE, offset);
  return {
    season, event, page: Number(page), pageSize: PAGE_SIZE, totalCount, sort,
    rows,
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

  const tournaments = db.prepare(`
    SELECT t.tourn_id AS tournId, t.name, t.startDate, t.endDate,
           SUM(CASE WHEN h.result = 'W' THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN h.result = 'L' THEN 1 ELSE 0 END) AS losses,
           (SELECT earnedBid FROM toc_entries
              WHERE tournId = t.tourn_id AND teamKey = ? AND eventAbbr = ? LIMIT 1) AS earnedBid,
           (SELECT place FROM toc_results
              WHERE tournId = t.tourn_id AND eventAbbr = ? AND entryId =
                 (SELECT entryId FROM toc_entries WHERE tournId = t.tourn_id AND teamKey = ? AND eventAbbr = ? LIMIT 1)
              LIMIT 1) AS place
    FROM toc_rating_history h
    JOIN toc_tournaments t ON t.tourn_id = h.tournId
    WHERE h.season = ? AND h.eventAbbr = ? AND h.teamKey = ?
    GROUP BY t.tourn_id
    ORDER BY t.startDate ASC
  `).all(teamKey, event, event, teamKey, event, season, event, teamKey);

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

  return {
    teamKey, season, event,
    displayName: rating.displayName, schoolName: rating.schoolName, schoolCode: rating.schoolCode,
    rating: { current: rating.rating, peak: rating.peakRating, rank, outOf: total },
    record: { wins: rating.wins, losses: rating.losses, winPct, roundCount: rating.roundCount },
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
