'use strict';

const { getDb } = require('./db');

// ── Tournaments ───────────────────────────────────────────────

function upsertTournament(t) {
  getDb().prepare(`
    INSERT INTO toc_tournaments (tourn_id, name, webname, city, state, country, startDate, endDate, season, lastCrawled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tourn_id) DO UPDATE SET
      name        = excluded.name,
      webname     = excluded.webname,
      city        = excluded.city,
      state       = excluded.state,
      country     = excluded.country,
      startDate   = excluded.startDate,
      endDate     = excluded.endDate,
      season      = excluded.season,
      lastCrawled = excluded.lastCrawled
  `).run(
    Number(t.tourn_id), t.name, t.webname || null,
    t.city || null, t.state || null, t.country || null,
    t.startDate, t.endDate, t.season,
    t.lastCrawled || new Date().toISOString()
  );
}

function getTournament(id) {
  return getDb().prepare(`SELECT * FROM toc_tournaments WHERE tourn_id = ?`).get(Number(id));
}

function listTournaments({ season, when }) {
  const db = getDb();
  const nowIso = new Date().toISOString().slice(0, 10);
  let sql = `SELECT * FROM toc_tournaments WHERE season = ?`;
  const args = [season];
  if (when === 'upcoming') { sql += ` AND endDate >= ?`; args.push(nowIso); }
  else if (when === 'past') { sql += ` AND endDate < ?`;  args.push(nowIso); }
  sql += ` ORDER BY startDate ASC`;
  return db.prepare(sql).all(...args);
}

function listSeasons() {
  return getDb().prepare(`
    SELECT season, COUNT(*) AS tournamentCount
    FROM toc_tournaments GROUP BY season ORDER BY season DESC
  `).all();
}

function countTournaments() {
  return getDb().prepare(`SELECT COUNT(*) AS n FROM toc_tournaments`).get().n;
}

function setTournamentCrawled(tournId) {
  getDb().prepare(`UPDATE toc_tournaments SET lastCrawled = ? WHERE tourn_id = ?`)
    .run(new Date().toISOString(), Number(tournId));
}

// ── Events ────────────────────────────────────────────────────

function upsertEvent(tournId, e) {
  getDb().prepare(`
    INSERT INTO toc_tournament_events (tournId, eventId, abbr, name, bidLevel, fullBids, partialBids)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tournId, eventId) DO UPDATE SET
      abbr        = excluded.abbr,
      name        = excluded.name,
      bidLevel    = excluded.bidLevel,
      fullBids    = excluded.fullBids,
      partialBids = excluded.partialBids
  `).run(Number(tournId), Number(e.eventId), e.abbr, e.name || null, e.bidLevel, e.fullBids, e.partialBids);
}

function listEvents(tournId) {
  return getDb().prepare(`SELECT * FROM toc_tournament_events WHERE tournId = ? ORDER BY abbr`).all(Number(tournId));
}

// ── Entries ───────────────────────────────────────────────────

function upsertEntry(tournId, entry) {
  getDb().prepare(`
    INSERT INTO toc_entries (tournId, eventAbbr, entryId, teamKey, schoolId, schoolName, schoolCode, displayName, earnedBid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tournId, entryId) DO UPDATE SET
      eventAbbr   = excluded.eventAbbr,
      teamKey     = excluded.teamKey,
      schoolId    = excluded.schoolId,
      schoolName  = excluded.schoolName,
      schoolCode  = excluded.schoolCode,
      displayName = excluded.displayName,
      earnedBid   = excluded.earnedBid
  `).run(
    Number(tournId), entry.eventAbbr, Number(entry.entryId), entry.teamKey,
    entry.schoolId != null ? Number(entry.schoolId) : null,
    entry.schoolName || null, entry.schoolCode || null,
    entry.displayName || null, entry.earnedBid || null
  );
}

function clearEntriesForTournament(tournId) {
  getDb().prepare(`DELETE FROM toc_entries WHERE tournId = ?`).run(Number(tournId));
}

function getEntry(entryId) {
  return getDb().prepare(`SELECT * FROM toc_entries WHERE entryId = ? LIMIT 1`).get(Number(entryId));
}

function listEntriesForEvent(tournId, eventAbbr) {
  return getDb().prepare(`
    SELECT * FROM toc_entries WHERE tournId = ? AND eventAbbr = ?
    ORDER BY displayName
  `).all(Number(tournId), eventAbbr);
}

// ── Ballots ───────────────────────────────────────────────────

function insertBallot(b) {
  getDb().prepare(`
    INSERT OR REPLACE INTO toc_ballots
      (id, tournId, eventAbbr, roundId, roundName, roundType, entryId, opponentEntryId, side, judgeName, result, speakerPoints)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(b.id, b.tournId, b.eventAbbr, b.roundId, b.roundName, b.roundType,
         b.entryId, b.opponentEntryId, b.side, b.judgeName, b.result, b.speakerPoints);
}

function clearBallotsForTournament(tournId) {
  getDb().prepare(`DELETE FROM toc_ballots WHERE tournId = ?`).run(Number(tournId));
}

function getPairingsForEntry(entryId) {
  return getDb().prepare(`
    SELECT * FROM toc_ballots WHERE entryId = ?
    ORDER BY roundType DESC, CAST(roundName AS INTEGER), roundName
  `).all(Number(entryId));
}

// ── Results ───────────────────────────────────────────────────

function upsertResult(r) {
  getDb().prepare(`
    INSERT INTO toc_results (tournId, eventAbbr, entryId, place, rank, speakerRank, speakerPoints)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tournId, entryId, eventAbbr) DO UPDATE SET
      place         = COALESCE(excluded.place, place),
      rank          = COALESCE(excluded.rank, rank),
      speakerRank   = COALESCE(excluded.speakerRank, speakerRank),
      speakerPoints = COALESCE(excluded.speakerPoints, speakerPoints)
  `).run(r.tournId, r.eventAbbr, r.entryId, r.place || null,
         r.rank != null ? Number(r.rank) : null,
         r.speakerRank != null ? Number(r.speakerRank) : null,
         r.speakerPoints != null ? Number(r.speakerPoints) : null);
}

function clearResultsForTournament(tournId) {
  getDb().prepare(`DELETE FROM toc_results WHERE tournId = ?`).run(Number(tournId));
}

function listResults(tournId, eventAbbr) {
  return getDb().prepare(`
    SELECT r.*, e.displayName, e.schoolName, e.schoolCode, e.earnedBid
    FROM toc_results r
    JOIN toc_entries e ON e.tournId = r.tournId AND e.entryId = r.entryId AND e.eventAbbr = r.eventAbbr
    WHERE r.tournId = ? AND r.eventAbbr = ?
    ORDER BY r.rank ASC NULLS LAST, r.speakerRank ASC NULLS LAST
  `).all(Number(tournId), eventAbbr);
}

function listSpeakerAwards(tournId, eventAbbr, limit = 20) {
  return getDb().prepare(`
    SELECT r.*, e.displayName, e.schoolName, e.schoolCode
    FROM toc_results r
    JOIN toc_entries e ON e.tournId = r.tournId AND e.entryId = r.entryId AND e.eventAbbr = r.eventAbbr
    WHERE r.tournId = ? AND r.eventAbbr = ? AND r.speakerRank IS NOT NULL
    ORDER BY r.speakerRank ASC LIMIT ?
  `).all(Number(tournId), eventAbbr, Number(limit));
}

// ── Season bids ───────────────────────────────────────────────

function rebuildSeasonBids(season) {
  const db = getDb();
  const tx = db.transaction((s) => {
    db.prepare(`DELETE FROM toc_season_bids WHERE season = ?`).run(s);
    db.prepare(`
      INSERT INTO toc_season_bids (season, teamKey, eventAbbr, fullBids, partialBids, displayName, schoolCode)
      SELECT t.season, e.teamKey, e.eventAbbr,
             SUM(CASE WHEN e.earnedBid = 'Full'    THEN 1 ELSE 0 END),
             SUM(CASE WHEN e.earnedBid = 'Partial' THEN 1 ELSE 0 END),
             MAX(e.displayName), MAX(e.schoolCode)
      FROM toc_entries e
      JOIN toc_tournaments t ON t.tourn_id = e.tournId
      WHERE t.season = ?
      GROUP BY t.season, e.teamKey, e.eventAbbr
    `).run(s);
  });
  tx(season);
}

function listThreats(tournId, eventAbbr, season) {
  return getDb().prepare(`
    SELECT
      e.*,
      COALESCE(sb.fullBids, 0) AS seasonFullBids,
      COALESCE(sb.partialBids, 0) AS seasonPartialBids,
      (SELECT w.id FROM wiki_teams w
        WHERE LOWER(w.school) = LOWER(e.schoolName)
          AND LOWER(w.code)   = LOWER(SUBSTR(e.displayName, LENGTH(e.schoolName) + 2))
        LIMIT 1) AS wikiTeamId
    FROM toc_entries e
    LEFT JOIN toc_season_bids sb
      ON e.teamKey = sb.teamKey AND sb.eventAbbr = e.eventAbbr AND sb.season = ?
    WHERE e.tournId = ? AND e.eventAbbr = ?
    ORDER BY seasonFullBids DESC, seasonPartialBids DESC, e.displayName ASC
  `).all(season, Number(tournId), eventAbbr);
}

module.exports = {
  upsertTournament, getTournament, listTournaments, listSeasons, countTournaments, setTournamentCrawled,
  upsertEvent, listEvents,
  upsertEntry, clearEntriesForTournament, getEntry, listEntriesForEvent,
  insertBallot, clearBallotsForTournament, getPairingsForEntry,
  upsertResult, clearResultsForTournament, listResults, listSpeakerAwards,
  rebuildSeasonBids, listThreats,
};
