'use strict';
/**
 * /api/me/tabroom-link  — link/unlink Tabroom team codes to user account
 * /api/me/tabroom/*     — upcoming tournaments and past results for linked codes
 */
const express      = require('express');
const router       = express.Router();
const { randomUUID } = require('crypto');
const zlib         = require('zlib');
const { getDb }    = require('../services/db');
const requireUser  = require('../middleware/requireUser');

router.use(requireUser);

// ── POST /api/me/tabroom-link ─────────────────────────────────────────────
// Search entry index for a team code; return distinct school matches so user
// can disambiguate before confirming.
router.post('/tabroom-link', (req, res) => {
  const { teamCode, schoolName } = req.body || {};
  if (!teamCode || typeof teamCode !== 'string') {
    return res.status(400).json({ error: 'teamCode required' });
  }
  const db = getDb();
  const pattern = `%${teamCode.trim()}%`;
  let rows;
  if (schoolName) {
    rows = db.prepare(`
      SELECT DISTINCT teamCode, schoolName, eventAbbr, eventName
      FROM tabroom_entry_index
      WHERE teamCode LIKE ? AND schoolName LIKE ?
      LIMIT 50
    `).all(pattern, `%${schoolName.trim()}%`);
  } else {
    rows = db.prepare(`
      SELECT DISTINCT teamCode, schoolName, eventAbbr, eventName
      FROM tabroom_entry_index
      WHERE teamCode LIKE ?
      LIMIT 50
    `).all(pattern);
  }
  // Group by (teamCode, schoolName)
  const grouped = {};
  for (const r of rows) {
    const key = `${r.teamCode}||${r.schoolName}`;
    if (!grouped[key]) grouped[key] = { teamCode: r.teamCode, schoolName: r.schoolName, events: [] };
    grouped[key].events.push({ abbr: r.eventAbbr, name: r.eventName });
  }
  res.json({ matches: Object.values(grouped) });
});

// ── POST /api/me/tabroom-link/confirm ─────────────────────────────────────
router.post('/tabroom-link/confirm', (req, res) => {
  const { teamCode, schoolName } = req.body || {};
  if (!teamCode || typeof teamCode !== 'string') {
    return res.status(400).json({ error: 'teamCode required' });
  }
  const db = getDb();
  const id = randomUUID();
  const createdAt = Date.now();
  try {
    db.prepare(`
      INSERT INTO user_tabroom_links (id, userId, teamCode, schoolName, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, req.user.id, teamCode.trim(), schoolName || null, createdAt);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      // Already linked — return existing
      const existing = db.prepare(
        'SELECT * FROM user_tabroom_links WHERE userId = ? AND teamCode = ? AND schoolName IS ?'
      ).get(req.user.id, teamCode.trim(), schoolName || null);
      return res.json({ link: existing });
    }
    throw err;
  }
  res.status(201).json({ link: { id, userId: req.user.id, teamCode, schoolName: schoolName || null, createdAt } });
});

// ── GET /api/me/tabroom-link ──────────────────────────────────────────────
router.get('/tabroom-link', (req, res) => {
  const links = getDb().prepare(
    'SELECT * FROM user_tabroom_links WHERE userId = ? ORDER BY createdAt DESC'
  ).all(req.user.id);
  res.json({ links });
});

// ── DELETE /api/me/tabroom-link/:id ──────────────────────────────────────
router.delete('/tabroom-link/:id', (req, res) => {
  const info = getDb().prepare(
    'DELETE FROM user_tabroom_links WHERE id = ? AND userId = ?'
  ).run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ── GET /api/me/tabroom/upcoming ─────────────────────────────────────────
// Tournaments where user's linked team codes appear AND startDate >= today.
router.get('/tabroom/upcoming', (req, res) => {
  const db = getDb();
  const links = db.prepare(
    'SELECT teamCode FROM user_tabroom_links WHERE userId = ?'
  ).all(req.user.id);
  if (!links.length) return res.json({ tournaments: [] });

  const codes = links.map(l => l.teamCode);
  const today = new Date().toISOString().slice(0, 10);
  const placeholders = codes.map(() => '?').join(',');

  const rows = db.prepare(`
    SELECT DISTINCT
      c.tournId, c.name, c.startDate, c.endDate,
      e.teamCode, e.schoolName, e.eventAbbr, e.eventName, e.studentNames
    FROM tabroom_tournament_cache c
    JOIN tabroom_entry_index e ON e.tournId = c.tournId
    WHERE c.startDate >= ?
      AND e.teamCode IN (${placeholders})
    ORDER BY c.startDate ASC
    LIMIT 20
  `).all(today, ...codes);

  // Group by tournament
  const byTourn = {};
  for (const r of rows) {
    if (!byTourn[r.tournId]) {
      byTourn[r.tournId] = { tournId: r.tournId, name: r.name, startDate: r.startDate, endDate: r.endDate, entries: [] };
    }
    let students = [];
    try { students = JSON.parse(r.studentNames); } catch {}
    byTourn[r.tournId].entries.push({
      teamCode: r.teamCode, schoolName: r.schoolName,
      eventAbbr: r.eventAbbr, eventName: r.eventName, students,
    });
  }
  res.json({ tournaments: Object.values(byTourn) });
});

// ── GET /api/me/tabroom/results ──────────────────────────────────────────
// Past tournaments + round-by-round records for user's linked codes.
router.get('/tabroom/results', (req, res) => {
  const db = getDb();
  const links = db.prepare(
    'SELECT teamCode FROM user_tabroom_links WHERE userId = ?'
  ).all(req.user.id);
  if (!links.length) return res.json({ tournaments: [] });

  const codes = links.map(l => l.teamCode);
  const today = new Date().toISOString().slice(0, 10);
  const placeholders = codes.map(() => '?').join(',');

  const cachRows = db.prepare(`
    SELECT DISTINCT c.tournId, c.name, c.startDate, c.endDate, c.rawJson,
      e.teamCode, e.schoolName, e.eventAbbr, e.entryId
    FROM tabroom_tournament_cache c
    JOIN tabroom_entry_index e ON e.tournId = c.tournId
    WHERE (c.endDate IS NULL OR c.endDate < ?)
      AND e.teamCode IN (${placeholders})
    ORDER BY c.startDate DESC
    LIMIT 10
  `).all(today, ...codes);

  // For each tournament, decompress rawJson and extract ballot records
  const byTourn = {};
  for (const row of cachRows) {
    if (!byTourn[row.tournId]) {
      let tournJson = null;
      try {
        const buf = zlib.gunzipSync(row.rawJson);
        tournJson = JSON.parse(buf.toString('utf8'));
      } catch { /* skip */ }
      byTourn[row.tournId] = {
        tournId:   row.tournId,
        name:      row.name,
        startDate: row.startDate,
        endDate:   row.endDate,
        entries:   [],
        rounds:    [],
        _json:     tournJson,
      };
    }
    let students = [];
    try { students = JSON.parse(row.studentNames || '[]'); } catch {}
    byTourn[row.tournId].entries.push({
      teamCode: row.teamCode, schoolName: row.schoolName,
      eventAbbr: row.eventAbbr, entryId: row.entryId,
    });
  }

  // Extract round records from decompressed JSON
  const userCodes = new Set(codes.map(c => c.toLowerCase()));
  for (const tourn of Object.values(byTourn)) {
    const json = tourn._json;
    delete tourn._json;
    if (!json) continue;
    const rounds = [];
    for (const cat of (json.categories || [])) {
      for (const ev of (cat.events || [])) {
        for (const round of (ev.rounds || [])) {
          for (const section of (round.sections || [])) {
            for (const ballot of (section.ballots || [])) {
              const code = (ballot.entry_code || '').toLowerCase();
              if (!userCodes.has(code)) continue;
              rounds.push({
                event:      ev.abbr || ev.name,
                round:      round.name,
                entryCode:  ballot.entry_code,
                entryName:  ballot.entry_name,
                judge:      ballot.judge,
                side:       ballot.side,
                scores:     ballot.scores || [],
              });
            }
          }
        }
      }
    }
    tourn.rounds = rounds;
  }

  res.json({ tournaments: Object.values(byTourn) });
});

module.exports = router;
