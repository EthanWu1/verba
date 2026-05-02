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

// Live count of THIS user's saved cards (for the Today page).
// /api/library/count counts the global imported corpus, which isn't useful for
// "your library" stats — use this instead.
router.get('/count', (req, res) => {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM user_saved_cards WHERE userId = ?').get(req.user.id);
  res.set('Cache-Control', 'no-store');
  res.json({ count: row.n || 0 });
});

// Per-user analytics: top topicLabels across the user's own saved cards.
// Mirrors getLibraryAnalytics shape (topTopics: [{label, count}]) so the
// Today page can render it with no extra adapter.
router.get('/analytics', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT payload FROM user_saved_cards WHERE userId = ?').all(req.user.id);
  const tally = new Map();
  let total = 0;
  for (const r of rows) {
    let p = {};
    try { p = JSON.parse(r.payload); } catch { continue; }
    total++;
    const label = String(p.topicLabel || '').trim();
    if (!label) continue;
    tally.set(label, (tally.get(label) || 0) + 1);
  }
  const topTopics = [...tally.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 200);
  res.set('Cache-Control', 'no-store');
  res.json({ totals: { cards: total }, topTopics });
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
