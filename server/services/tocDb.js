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
  let sql = `
    SELECT t.* FROM toc_tournaments t
    WHERE t.season = ?
      AND EXISTS (
        SELECT 1 FROM toc_tournament_events te
        WHERE te.tournId = t.tourn_id AND te.bidLevel IS NOT NULL
      )
  `;
  const args = [season];
  if (when === 'upcoming') { sql += ` AND t.endDate >= ?`; args.push(nowIso); }
  else if (when === 'past') { sql += ` AND t.endDate < ?`;  args.push(nowIso); }
  sql += ` ORDER BY t.startDate ASC`;
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

function clearEventsForTournament(tournId) {
  getDb().prepare(`DELETE FROM toc_tournament_events WHERE tournId = ?`).run(Number(tournId));
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

const COUNT_TO_DEPTH = { 256: 'Partials', 128: 'Partials', 64: 'Triples', 32: 'Doubles', 16: 'Octos', 8: 'Quarters', 4: 'Semis', 2: 'Finals' };

function getPairingsForEntry(entryId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT b.*,
           opp.displayName AS opponentName,
           opp.schoolName  AS opponentSchool
    FROM toc_ballots b
    LEFT JOIN toc_entries opp
      ON opp.tournId = b.tournId
     AND opp.entryId = b.opponentEntryId
     AND opp.eventAbbr = b.eventAbbr
    WHERE b.entryId = ?
    ORDER BY CASE b.roundType WHEN 'prelim' THEN 0 ELSE 1 END,
             CAST(b.roundName AS INTEGER),
             b.roundName,
             b.id
  `).all(Number(entryId));

  const depthByRoundId = new Map();
  if (rows.length) {
    const tournId = rows[0].tournId;
    const eventAbbr = rows[0].eventAbbr;
    const counts = db.prepare(`
      SELECT roundId, COUNT(DISTINCT entryId) AS entryCount
      FROM toc_ballots
      WHERE tournId = ? AND eventAbbr = ? AND roundType != 'prelim'
      GROUP BY roundId
    `).all(tournId, eventAbbr);
    for (const c of counts) {
      if (COUNT_TO_DEPTH[c.entryCount]) depthByRoundId.set(c.roundId, COUNT_TO_DEPTH[c.entryCount]);
    }
  }
  const byRound = new Map();
  for (const r of rows) {
    const key = `${r.roundType}|${r.roundName}|${r.roundId || r.opponentEntryId || r.id}`;
    if (!byRound.has(key)) {
      byRound.set(key, {
        roundType: r.roundType,
        roundName: r.roundName,
        roundId: r.roundId,
        depth: depthByRoundId.get(r.roundId) || null,
        side: r.side,
        opponentEntryId: r.opponentEntryId,
        opponentName: r.opponentName,
        opponentSchool: r.opponentSchool,
        judgeNames: [],
        ballotResults: [],
        wins: 0,
        losses: 0,
        speakerPointsTotal: 0,
        speakerPointsCount: 0,
      });
    }
    const agg = byRound.get(key);
    if (r.judgeName && !agg.judgeNames.includes(r.judgeName)) agg.judgeNames.push(r.judgeName);
    if (r.result === 'W' || r.result === 'L') agg.ballotResults.push(r.result);
    if (r.result === 'W') agg.wins++;
    else if (r.result === 'L') agg.losses++;
    if (r.speakerPoints != null) {
      agg.speakerPointsTotal += r.speakerPoints;
      agg.speakerPointsCount++;
    }
  }
  return [...byRound.values()].map(r => ({
    roundType: r.roundType,
    roundName: r.roundName,
    depth: r.depth,
    side: r.side,
    opponentEntryId: r.opponentEntryId,
    opponentName: r.opponentName,
    opponentSchool: r.opponentSchool,
    judgeName: r.judgeNames.join(', ') || null,
    ballotResults: r.ballotResults,
    result: r.wins > r.losses ? 'W' : r.losses > r.wins ? 'L' : null,
    ballotCount: r.wins + r.losses,
    speakerPoints: r.speakerPointsCount ? r.speakerPointsTotal / r.speakerPointsCount : null,
  }));
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
             SUM(CASE WHEN e.earnedBid = 'Full' THEN 1 ELSE 0 END),
             SUM(CASE WHEN e.earnedBid IS NOT NULL AND e.earnedBid != 'Full' THEN 1 ELSE 0 END),
             MAX(e.displayName), MAX(e.schoolCode)
      FROM toc_entries e
      JOIN toc_tournaments t ON t.tourn_id = e.tournId
      WHERE t.season = ?
      GROUP BY t.season, e.teamKey, e.eventAbbr
    `).run(s);
  });
  tx(season);
}

// Per-entry prelim + elim win/loss counts, aggregated so 3-judge panels count as ONE round.
function listRecordsForTournament(tournId, eventAbbr) {
  const rows = getDb().prepare(`
    SELECT entryId, roundId, roundType,
           SUM(CASE WHEN result='W' THEN 1 ELSE 0 END) AS w,
           SUM(CASE WHEN result='L' THEN 1 ELSE 0 END) AS l
    FROM toc_ballots
    WHERE tournId = ? AND eventAbbr = ?
    GROUP BY entryId, roundId
  `).all(Number(tournId), eventAbbr);
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.entryId)) out.set(r.entryId, { prelimWins: 0, prelimLosses: 0, elimWins: 0, elimLosses: 0 });
    const rec = out.get(r.entryId);
    const isPrelim = r.roundType === 'prelim' || r.roundType === 'highlow';
    if (r.w > r.l)      (isPrelim ? rec.prelimWins++ : rec.elimWins++);
    else if (r.l > r.w) (isPrelim ? rec.prelimLosses++ : rec.elimLosses++);
    else                (isPrelim ? rec.prelimWins++ : rec.elimWins++); // BYE counts as win
  }
  return out;
}

// Infer final places for a tournament from toc_ballots when toc_results is empty.
// Each entry's place is the depth label of the deepest elim round they played, with
// winners of the final receiving "1st" and the final losers "2nd".
function inferResultsFromBallots(tournId, eventAbbr) {
  const db = getDb();
  const ballots = db.prepare(`
    SELECT b.roundId, b.roundName, b.roundType, b.entryId, b.result,
           e.displayName, e.schoolName, e.schoolCode, e.earnedBid
    FROM toc_ballots b
    JOIN toc_entries e ON e.tournId = b.tournId AND e.entryId = b.entryId AND e.eventAbbr = b.eventAbbr
    WHERE b.tournId = ? AND b.eventAbbr = ?
  `).all(Number(tournId), eventAbbr);
  if (!ballots.length) return [];
  const records = listRecordsForTournament(tournId, eventAbbr);

  // Split elim-only ballots for depth inference below.
  const elimBallots = ballots.filter(b => b.roundType !== 'prelim' && b.roundType !== 'highlow');

  // Count unique entries per elim roundId (to infer depth).
  const entriesPerRound = new Map();
  for (const b of elimBallots) {
    if (!entriesPerRound.has(b.roundId)) entriesPerRound.set(b.roundId, new Set());
    entriesPerRound.get(b.roundId).add(b.entryId);
  }

  // Aggregate elim ballots per (entry, round) for depth lookup.
  const key = (e, r) => `${e}|${r}`;
  const agg = new Map();
  for (const b of elimBallots) {
    const k = key(b.entryId, b.roundId);
    if (!agg.has(k)) agg.set(k, { wins: 0, losses: 0, roundId: b.roundId, entryId: b.entryId, meta: b });
    const a = agg.get(k);
    if (b.result === 'W') a.wins++;
    else if (b.result === 'L') a.losses++;
  }

  // Deepest elim round each entry played.
  const perEntry = new Map();
  for (const { roundId, entryId, wins, losses, meta } of agg.values()) {
    const size = entriesPerRound.get(roundId).size;
    if (!perEntry.has(entryId) || perEntry.get(entryId).size > size) {
      perEntry.set(entryId, { size, roundId, wins, losses, meta });
    }
  }

  // Meta per-entry (for prelim-only players we still need displayName/school).
  const entryMeta = new Map();
  for (const b of ballots) if (!entryMeta.has(b.entryId)) entryMeta.set(b.entryId, b);

  const results = [];
  for (const [entryId, meta] of entryMeta.entries()) {
    const info = perEntry.get(entryId);
    const rec = records.get(entryId) || { prelimWins: 0, prelimLosses: 0, elimWins: 0, elimLosses: 0 };
    let place;
    if (info) {
      const depth = COUNT_TO_DEPTH[info.size];
      const won = info.wins > info.losses;
      if (info.size === 2) place = won ? '1st' : '2nd';
      else place = depth || ('Round ' + info.meta.roundName);
    } else {
      place = 'Prelim';
    }
    results.push({
      tournId: Number(tournId),
      eventAbbr,
      entryId,
      place,
      rank: null,
      displayName: meta.displayName,
      schoolName: meta.schoolName,
      schoolCode: meta.schoolCode,
      earnedBid: meta.earnedBid,
      ...rec,
    });
  }
  const PLACE_ORDER = { '1st': 0, '2nd': 1, '3rd': 2, Semis: 3, Quarters: 4, Octos: 5, Doubles: 6, Triples: 7, Partials: 8, Prelim: 99 };
  results.sort((a, b) => (PLACE_ORDER[a.place] ?? 50) - (PLACE_ORDER[b.place] ?? 50));
  return results;
}

function listThreats(tournId, eventAbbr, season) {
  return getDb().prepare(`
    SELECT
      e.*,
      COALESCE(sb.fullBids, 0) AS seasonFullBids,
      COALESCE(sb.partialBids, 0) AS seasonPartialBids,
      (SELECT w.id FROM wiki_teams w
        WHERE LOWER(w.school) = LOWER(e.schoolName)
          AND (' ' || LOWER(e.displayName) || ' ') LIKE '% ' || LOWER(w.code) || ' %'
        LIMIT 1) AS wikiTeamId
    FROM toc_entries e
    LEFT JOIN toc_season_bids sb
      ON e.teamKey = sb.teamKey AND sb.eventAbbr = e.eventAbbr AND sb.season = ?
    WHERE e.tournId = ? AND e.eventAbbr = ?
    ORDER BY seasonFullBids DESC, seasonPartialBids DESC, e.displayName ASC
  `).all(season, Number(tournId), eventAbbr);
}

function listEnrichedThreats(tournId, eventAbbr, season) {
  const threats = listThreats(Number(tournId), eventAbbr, season);
  const placements = getDb().prepare(`
    SELECT r.entryId, r.place, te.bidLevel, e.teamKey
    FROM toc_results r
    JOIN toc_entries e ON e.tournId = r.tournId AND e.entryId = r.entryId AND e.eventAbbr = r.eventAbbr
    JOIN toc_tournaments t ON t.tourn_id = r.tournId
    JOIN toc_tournament_events te ON te.tournId = r.tournId AND te.abbr = r.eventAbbr
    WHERE t.season = ? AND r.eventAbbr = ? AND e.teamKey IN (${threats.map(() => '?').join(',') || "''"})
      AND r.place IS NOT NULL
  `).all(season, eventAbbr, ...threats.map(t => t.teamKey));

  const byTeam = new Map();
  for (const p of placements) {
    if (!byTeam.has(p.teamKey)) byTeam.set(p.teamKey, []);
    byTeam.get(p.teamKey).push({ place: p.place, bidLevel: p.bidLevel });
  }
  return threats.map(t => ({
    ...t,
    recentPlacements: byTeam.get(t.teamKey) || [],
  }));
}

function listElimRounds(tournId, eventAbbr) {
  return getDb().prepare(`
    SELECT b.roundId, b.roundName, b.roundType, b.entryId, b.opponentEntryId, b.result, b.side,
           e.displayName, e.schoolName, e.schoolCode
    FROM toc_ballots b
    LEFT JOIN toc_entries e ON e.tournId = b.tournId AND e.entryId = b.entryId AND e.eventAbbr = b.eventAbbr
    WHERE b.tournId = ? AND b.eventAbbr = ? AND b.roundType = 'elim'
    ORDER BY CAST(b.roundName AS INTEGER), b.roundName, b.entryId
  `).all(Number(tournId), eventAbbr);
}

module.exports = {
  upsertTournament, getTournament, listTournaments, listSeasons, countTournaments, setTournamentCrawled,
  upsertEvent, listEvents, clearEventsForTournament,
  upsertEntry, clearEntriesForTournament, getEntry, listEntriesForEvent,
  insertBallot, clearBallotsForTournament, getPairingsForEntry,
  upsertResult, clearResultsForTournament, listResults, listSpeakerAwards, inferResultsFromBallots, listRecordsForTournament,
  rebuildSeasonBids, listThreats, listEnrichedThreats, listElimRounds,
};
