'use strict';

const express = require('express');
const router = express.Router();
const db = require('../services/tocDb');
const indexer = require('../services/tocIndexer');
const requireUser = require('../middleware/requireUser');

const STALE_MS = 24 * 60 * 60 * 1000;

const VALID_EVENTS = new Set(['LD', 'PF', 'CX']);
function _validateEvent(req, res) {
  const ev = String(req.params.event || '').toUpperCase();
  if (!VALID_EVENTS.has(ev)) { res.status(400).json({ error: 'invalid_event' }); return null; }
  return ev;
}

function _isStale(t) {
  if (!t.lastCrawled) return true;
  if (t.endDate && new Date(t.endDate).getTime() < Date.now() - 24 * 60 * 60 * 1000) return false;
  return Date.now() - new Date(t.lastCrawled).getTime() > STALE_MS;
}

router.get('/seasons', (req, res) => {
  return res.json({ seasons: db.listSeasons() });
});

router.get('/tournaments', (req, res) => {
  const season = String(req.query.season || '');
  const when   = String(req.query.when || 'upcoming');
  const rows = db.listTournaments({ season, when });
  const out = rows.map(t => ({ ...t, events: db.listEvents(t.tourn_id) }));
  return res.json({ tournaments: out });
});

router.get('/tournaments/:id', (req, res) => {
  const id = Number(req.params.id);
  const t = db.getTournament(id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  if (_isStale(t)) {
    indexer.crawlTournament(id).catch(err => console.error('[toc] crawl error:', err.message));
  }
  return res.json({ tournament: t, events: db.listEvents(id) });
});

router.get('/tournaments/:id/threats/:event', (req, res) => {
  const ev = _validateEvent(req, res); if (!ev) return;
  const id = Number(req.params.id);
  const t = db.getTournament(id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  const rows = db.listThreats(id, ev, t.season);
  return res.json({ threats: rows, season: t.season });
});

router.get('/tournaments/:id/results/:event', (req, res) => {
  const ev = _validateEvent(req, res); if (!ev) return;
  const id = Number(req.params.id);
  return res.json({
    results: db.listResults(id, ev),
    speakers: db.listSpeakerAwards(id, ev, 20),
  });
});

router.get('/entries/:entryId/pairings', (req, res) => {
  const entryId = Number(req.params.entryId);
  const entry = db.getEntry(entryId);
  if (!entry) return res.status(404).json({ error: 'not_found' });
  return res.json({ entry, pairings: db.getPairingsForEntry(entryId) });
});

router.get('/tournaments/:id/refresh', requireUser, async (req, res) => {
  try {
    await indexer.crawlTournament(Number(req.params.id));
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/reindex', requireUser, (req, res) => {
  res.json({ ok: true, message: 'Reindexing started' });
  indexer.seedTocIndex().catch(err => console.error('[toc] reindex error:', err.message));
});

module.exports = router;
