'use strict';
const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { getDb } = require('../services/db');
const requireUser = require('../middleware/requireUser');

router.use(requireUser);

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM user_history WHERE userId = ? ORDER BY at DESC LIMIT 400').all(req.user.id);
  const items = rows.map(r => { try { return { id: r.id, ...JSON.parse(r.entry), at: r.at }; } catch { return null; } }).filter(Boolean);
  res.json({ items });
});

router.post('/', (req, res) => {
  const entry = req.body?.entry || {};
  const id = randomUUID();
  const at = new Date().toISOString();
  getDb().prepare('INSERT INTO user_history (id, userId, entry, at) VALUES (?, ?, ?, ?)').run(id, req.user.id, JSON.stringify(entry), at);
  getDb().prepare(`
    DELETE FROM user_history WHERE userId = ? AND id NOT IN (
      SELECT id FROM user_history WHERE userId = ? ORDER BY at DESC LIMIT 400
    )
  `).run(req.user.id, req.user.id);
  res.status(201).json({ id, ...entry, at });
});

router.delete('/', (req, res) => {
  getDb().prepare('DELETE FROM user_history WHERE userId = ?').run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
