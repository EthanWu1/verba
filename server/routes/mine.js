'use strict';
const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { getDb } = require('../services/db');
const requireUser = require('../middleware/requireUser');

router.use(requireUser);

function fingerprint(c) {
  const t = String(c.tag || '').trim().toLowerCase();
  const ci = String(c.cite || c.shortCite || '').trim().toLowerCase();
  const b = String(c.body_plain || c.body_markdown || '').slice(0, 200).trim().toLowerCase();
  return t + '|' + ci + '|' + b;
}

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM user_saved_cards WHERE userId = ? ORDER BY savedAt DESC').all(req.user.id);
  const items = rows.map(r => { try { return { id: r.id, ...JSON.parse(r.payload), savedAt: r.savedAt }; } catch { return null; } }).filter(Boolean);
  res.json({ items });
});

router.post('/', (req, res) => {
  const card = req.body?.card;
  if (!card || (!card.tag && !card.body_markdown && !card.body_plain)) return res.status(400).json({ error: 'card required' });
  const fp = fingerprint(card);
  const existing = getDb().prepare('SELECT * FROM user_saved_cards WHERE userId = ? AND fingerprint = ?').get(req.user.id, fp);
  if (existing) {
    let payload = {};
    try { payload = JSON.parse(existing.payload); } catch {}
    return res.status(200).json({ card: { id: existing.id, ...payload, savedAt: existing.savedAt }, duplicate: true });
  }
  const id = card.id || randomUUID();
  const savedAt = new Date().toISOString();
  getDb().prepare('INSERT INTO user_saved_cards (id, userId, payload, fingerprint, savedAt) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.user.id, JSON.stringify(card), fp, savedAt);
  res.status(201).json({ card: { id, ...card, savedAt }, duplicate: false });
});

router.delete('/:id', (req, res) => {
  const info = getDb().prepare('DELETE FROM user_saved_cards WHERE id = ? AND userId = ?').run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

module.exports = router;
