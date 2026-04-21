'use strict';

const express      = require('express');
const router       = express.Router();
const db           = require('../services/wikiDb');
const indexer      = require('../services/wikiIndexer');
const { getDb }    = require('../services/db');
const { buildDocx, buildProjectDocx } = require('../services/docxBuilder');
const requireUser  = require('../middleware/requireUser');

function _safeFilename(s) {
  return String(s || 'download').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'download';
}

// GET /api/wiki/teams?q=memorial&limit=100
router.get('/teams', (req, res) => {
  const q     = String(req.query.q || '');
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
  return res.json({ teams: db.searchTeams(q, limit), total: db.countTeams() });
});

// GET /api/wiki/teams/:id  — returns team + arguments; triggers crawl if stale
router.get('/teams/:id', async (req, res) => {
  const team = db.getTeam(req.params.id);
  if (!team) return res.status(404).json({ error: 'not_found' });

  if (db.isTeamStale(team) && team.crawlStatus !== 'crawling') {
    db.setTeamCrawlStatus(team.id, 'crawling');
    indexer.crawlTeamDetail(team.id).catch(err =>
      console.error('[wiki] crawl error:', err.message)
    );
  }

  const args = db.getTeamArguments(team.id);
  return res.json({ team, arguments: args });
});

// GET /api/wiki/teams/:id/refresh  — force re-crawl
router.get('/teams/:id/refresh', requireUser, async (req, res) => {
  const team = db.getTeam(req.params.id);
  if (!team) return res.status(404).json({ error: 'not_found' });
  db.setTeamCrawlStatus(team.id, 'pending');
  getDb().prepare(`UPDATE wiki_teams SET lastCrawled = NULL WHERE id = ?`).run(team.id);
  indexer.crawlTeamDetail(team.id).catch(err =>
    console.error('[wiki] refresh error:', err.message)
  );
  return res.json({ ok: true });
});

// GET /api/wiki/arguments/:id
router.get('/arguments/:id', (req, res) => {
  const arg = db.getArgument(req.params.id);
  if (!arg) return res.status(404).json({ error: 'not_found' });
  return res.json({ argument: arg });
});

// GET /api/wiki/teams/:id/export  — download all arguments as .docx
router.get('/teams/:id/export', async (req, res) => {
  const team = db.getTeam(req.params.id);
  if (!team) return res.status(404).json({ error: 'not_found' });
  try {
    const args = db.getTeamArguments(team.id);
    const sorted = [...args.filter(a => a.side === 'aff'), ...args.filter(a => a.side === 'neg')];
    const cards = sorted.map(a => ({
      tag:   `${a.name} (${a.side.toUpperCase()}) — ${a.readCount}×`,
      cite:  `${team.fullName} via opencaselist`,
      body_markdown: a.fullText,
    }));
    const buffer = await buildProjectDocx(team.fullName, cards);
    res.setHeader('Content-Disposition', `attachment; filename="${_safeFilename(team.fullName)}.docx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    return res.send(buffer);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/wiki/arguments/:id/export
router.get('/arguments/:id/export', async (req, res) => {
  const arg = db.getArgument(req.params.id);
  if (!arg) return res.status(404).json({ error: 'not_found' });
  try {
    const card = {
      tag:           `${arg.name} (${arg.side.toUpperCase()}) — ${arg.readCount}×`,
      cite:          'via opencaselist',
      body_markdown: arg.fullText,
    };
    const buffer = await buildDocx(card);
    res.setHeader('Content-Disposition', `attachment; filename="${_safeFilename(arg.name)}.docx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    return res.send(buffer);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/wiki/reindex  — re-crawl full team index
router.post('/reindex', requireUser, async (req, res) => {
  res.json({ ok: true, message: 'Reindexing started' });
  indexer.seedTeamIndex().catch(err =>
    console.error('[wiki] reindex error:', err.message)
  );
});

module.exports = router;
