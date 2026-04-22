'use strict';

const { getDb } = require('./db');

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Team index ───────────────────────────────────────────────

function upsertTeam({ school, code, fullName, event, pageUrl }) {
  const db = getDb();
  const id = slugify(`${school}-${code}`);
  db.prepare(`
    INSERT INTO wiki_teams (id, school, code, fullName, event, pageUrl)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      fullName = excluded.fullName,
      event    = excluded.event,
      pageUrl  = excluded.pageUrl
  `).run(id, school, code, fullName, event || null, pageUrl);
  return id;
}

function rebuildTeamsFts() {
  getDb().exec(`INSERT INTO wiki_teams_fts(wiki_teams_fts) VALUES('rebuild')`);
}

function searchTeams(q, limit = 100) {
  const db = getDb();
  if (!q || !q.trim()) {
    return db.prepare(`SELECT * FROM wiki_teams ORDER BY fullName LIMIT ?`).all(limit);
  }
  const tokens = String(q).replace(/["']/g, '').split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return db.prepare(`SELECT * FROM wiki_teams ORDER BY fullName LIMIT ?`).all(limit);
  }
  // Build safe FTS5 query: quote each token, append * to the last for prefix match.
  const fts = tokens.map((t, i) => {
    const safe = t.replace(/[^A-Za-z0-9_-]/g, '');
    if (!safe) return null;
    return i === tokens.length - 1 ? `"${safe}"*` : `"${safe}"`;
  }).filter(Boolean).join(' ');
  if (!fts) {
    return db.prepare(`SELECT * FROM wiki_teams ORDER BY fullName LIMIT ?`).all(limit);
  }
  return db.prepare(`
    SELECT t.* FROM wiki_teams t
    JOIN wiki_teams_fts f ON t.rowid = f.rowid
    WHERE wiki_teams_fts MATCH ?
    ORDER BY rank LIMIT ?
  `).all(fts, limit);
}

function getTeam(id) {
  return getDb().prepare(`SELECT * FROM wiki_teams WHERE id = ?`).get(id);
}

function setTeamCrawlStatus(id, status) {
  getDb().prepare(`UPDATE wiki_teams SET crawlStatus = ? WHERE id = ?`).run(status, id);
}

function setTeamCrawled(id) {
  getDb().prepare(`
    UPDATE wiki_teams SET crawlStatus = 'done', lastCrawled = ? WHERE id = ?
  `).run(new Date().toISOString(), id);
}

function isTeamStale(team) {
  if (!team.lastCrawled) return true;
  const age = Date.now() - new Date(team.lastCrawled).getTime();
  return age > 7 * 24 * 60 * 60 * 1000;
}

function countTeams() {
  return getDb().prepare(`SELECT COUNT(*) as n FROM wiki_teams`).get().n;
}

// ── Arguments ────────────────────────────────────────────────

function upsertArgument({ teamId, name, side, readCount, fullText }) {
  const db = getDb();
  const id = slugify(`${teamId}-${name}-${side}`);
  db.prepare(`
    INSERT INTO wiki_arguments (id, teamId, name, side, readCount, fullText, lastUpdated)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name        = excluded.name,
      readCount   = excluded.readCount,
      fullText    = excluded.fullText,
      lastUpdated = excluded.lastUpdated
  `).run(id, teamId, name, side, readCount, fullText, new Date().toISOString());
  return id;
}

function rebuildArgumentsFts() {
  getDb().exec(`INSERT INTO wiki_arguments_fts(wiki_arguments_fts) VALUES('rebuild')`);
}

function getTeamArguments(teamId) {
  return getDb().prepare(`
    SELECT * FROM wiki_arguments WHERE teamId = ? ORDER BY readCount DESC
  `).all(teamId);
}

function getArgument(id) {
  return getDb().prepare(`SELECT * FROM wiki_arguments WHERE id = ?`).get(id);
}

// ── Round reports ─────────────────────────────────────────────

function insertRoundReport({ teamId, argumentId, tournament, round, opponent, side }) {
  getDb().prepare(`
    INSERT INTO wiki_round_reports (teamId, argumentId, tournament, round, opponent, side)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(teamId, argumentId || null, tournament || null, round || null, opponent || null, side || null);
}

function clearRoundReports(teamId) {
  getDb().prepare(`DELETE FROM wiki_round_reports WHERE teamId = ?`).run(teamId);
}

function listTeamsByEvent({ event, q, limit = 200 }) {
  const params = [];
  let where = '1=1';
  if (event) { where += ' AND LOWER(event) = LOWER(?)'; params.push(event); }
  if (q) {
    const term = `%${q.toLowerCase()}%`;
    where += ' AND (LOWER(school) LIKE ? OR LOWER(code) LIKE ? OR LOWER(fullName) LIKE ?)';
    params.push(term, term, term);
  }
  const sql = `
    SELECT id, school, code, fullName, event, pageUrl, lastCrawled
    FROM wiki_teams
    WHERE ${where}
    ORDER BY school COLLATE NOCASE, code COLLATE NOCASE
    LIMIT ?
  `;
  params.push(Number(limit));
  return getDb().prepare(sql).all(...params);
}

module.exports = {
  upsertTeam, rebuildTeamsFts, searchTeams, getTeam,
  setTeamCrawlStatus, setTeamCrawled, isTeamStale, countTeams,
  upsertArgument, rebuildArgumentsFts, getTeamArguments, getArgument,
  insertRoundReport, clearRoundReports,
  listTeamsByEvent,
};
