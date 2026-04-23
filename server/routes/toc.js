'use strict';

const express = require('express');
const router = express.Router();
const db = require('../services/tocDb');
const indexer = require('../services/tocIndexer');
const requireUser = require('../middleware/requireUser');
const { shortenDisplayName, withShortenedName } = require('../services/nameUtil');

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
  const search = String(req.query.search || '').trim().toLowerCase();
  let rows = db.listTournaments({ season, when });
  if (search) {
    rows = rows.filter(t =>
      String(t.name || '').toLowerCase().includes(search) ||
      String(t.city || '').toLowerCase().includes(search) ||
      String(t.state || '').toLowerCase().includes(search)
    );
  }
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
  const enriched = db.listEnrichedThreats(id, ev, t.season);
  const qualified = enriched.filter(e =>
    (e.seasonFullBids || 0) > 0 ||
    (e.seasonPartialBids || 0) > 0 ||
    (Array.isArray(e.recentPlacements) && e.recentPlacements.length > 0)
  );
  const { scoreEntries } = require('../services/threatScorer');
  const ranked = scoreEntries(qualified, t.season, 30).map(withShortenedName);
  return res.json({ threats: ranked, season: t.season });
});

router.get('/tournaments/:id/results/:event', (req, res) => {
  const ev = _validateEvent(req, res); if (!ev) return;
  const id = Number(req.params.id);
  let results = db.listResults(id, ev);
  if (!results.length) {
    results = db.inferResultsFromBallots(id, ev);
  }
  return res.json({
    results:  results.map(withShortenedName),
    speakers: db.listSpeakerAwards(id, ev, 20).map(withShortenedName),
  });
});

router.get('/entries/:entryId/pairings', (req, res) => {
  const entryId = Number(req.params.entryId);
  const entry = db.getEntry(entryId);
  if (!entry) return res.status(404).json({ error: 'not_found' });
  const shortEntry = { ...entry, displayName: shortenDisplayName(entry.displayName, entry.schoolName) };
  const pairings = db.getPairingsForEntry(entryId).map(p => ({
    ...p,
    opponentName: shortenDisplayName(p.opponentName, p.opponentSchool),
  }));
  return res.json({ entry: shortEntry, pairings });
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

router.get('/tournaments/:id/bracket/:event', (req, res) => {
  const ev = _validateEvent(req, res); if (!ev) return;
  const id = Number(req.params.id);
  const rows = db.listElimRounds(id, ev);
  const byRoundId = new Map();
  for (const r of rows) {
    const key = r.roundId || r.roundName;
    if (!byRoundId.has(key)) byRoundId.set(key, { roundId: r.roundId, roundName: r.roundName, ballots: [] });
    byRoundId.get(key).ballots.push(r);
  }
  const COUNT_TO_DEPTH = { 256: 'Partials', 128: 'Partials', 64: 'Triples', 32: 'Doubles', 16: 'Octos', 8: 'Quarters', 4: 'Semis', 2: 'Finals' };
  const DEPTH_ORDER = { Partials: -1, Triples: 0, Doubles: 1, Octos: 2, Quarters: 3, Semis: 4, Finals: 5 };
  const rounds = [...byRoundId.values()].map(r => {
    const entries = new Set(r.ballots.map(b => b.entryId));
    const name = COUNT_TO_DEPTH[entries.size] || r.roundName || `Elim`;
    return { name, ballots: r.ballots };
  }).sort((a, b) => (DEPTH_ORDER[a.name] ?? 9) - (DEPTH_ORDER[b.name] ?? 9));
  return res.json({ rounds });
});

module.exports = router;
