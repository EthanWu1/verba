'use strict';

const express = require('express');
const router = express.Router();
const rdb = require('../services/rankingsDb');

const VALID_EVENTS = new Set(['LD', 'PF', 'CX']);

function _validateEvent(req, res) {
  const ev = String(req.query.event || '').toUpperCase();
  if (!VALID_EVENTS.has(ev)) { res.status(400).json({ error: 'invalid_event' }); return null; }
  return ev;
}

router.get('/seasons', (req, res) => {
  return res.json({ seasons: rdb.listSeasons(), events: ['LD', 'PF', 'CX'] });
});

router.get('/', (req, res) => {
  const ev = _validateEvent(req, res); if (!ev) return;
  const season = String(req.query.season || '');
  if (!season) return res.status(400).json({ error: 'missing_season' });
  const page = Math.max(1, Number(req.query.page) || 1);
  const q = String(req.query.q || '');
  const sort = String(req.query.sort || 'rating');
  try {
    return res.json(rdb.leaderboard({ season, event: ev, page, q, sort }));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:teamKey', (req, res) => {
  const ev = _validateEvent(req, res); if (!ev) return;
  const season = String(req.query.season || '');
  if (!season) return res.status(400).json({ error: 'missing_season' });
  try {
    const p = rdb.profile(decodeURIComponent(req.params.teamKey), season, ev);
    if (!p) return res.status(404).json({ error: 'not_found' });
    return res.json(p);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:teamKey/history', (req, res) => {
  const ev = _validateEvent(req, res); if (!ev) return;
  const season = String(req.query.season || '');
  if (!season) return res.status(400).json({ error: 'missing_season' });
  try {
    return res.json({ history: rdb.history(decodeURIComponent(req.params.teamKey), season, ev) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
