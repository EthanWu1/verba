'use strict';

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { getDb } = require('../services/db');
const requireUser = require('../middleware/requireUser');

router.use(requireUser);

function rowToProject(row) {
  if (!row) return null;
  let cards = [];
  try { cards = JSON.parse(row.cards); } catch {}
  return { id: row.id, name: row.name, color: row.color, cards, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM user_projects WHERE userId = ? ORDER BY updatedAt DESC').all(req.user.id);
  res.json({ items: rows.map(rowToProject) });
});

router.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const color = String(req.body?.color || '#6B7280').slice(0, 9);
  const now = new Date().toISOString();
  const project = { id: randomUUID(), userId: req.user.id, name, color, cards: '[]', createdAt: now, updatedAt: now };
  getDb().prepare('INSERT INTO user_projects (id, userId, name, color, cards, createdAt, updatedAt) VALUES (@id, @userId, @name, @color, @cards, @createdAt, @updatedAt)').run(project);
  res.status(201).json({ project: rowToProject(project) });
});

function ownedProject(userId, id) {
  return getDb().prepare('SELECT * FROM user_projects WHERE id = ? AND userId = ?').get(id, userId);
}

router.patch('/:id', (req, res) => {
  const row = ownedProject(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const name = req.body?.name != null ? String(req.body.name).trim() : row.name;
  const color = req.body?.color != null ? String(req.body.color).slice(0, 9) : row.color;
  const now = new Date().toISOString();
  getDb().prepare('UPDATE user_projects SET name = ?, color = ?, updatedAt = ? WHERE id = ?').run(name, color, now, row.id);
  res.json({ project: rowToProject({ ...row, name, color, updatedAt: now }) });
});

router.delete('/:id', (req, res) => {
  const info = getDb().prepare('DELETE FROM user_projects WHERE id = ? AND userId = ?').run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

router.post('/:id/cards', (req, res) => {
  const row = ownedProject(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const card = req.body?.card || {};
  if (!card.tag && !card.body_markdown && !card.body_plain) return res.status(400).json({ error: 'card requires tag or body' });
  const entry = { id: card.id || randomUUID(), ...card, addedAt: new Date().toISOString() };
  let cards = []; try { cards = JSON.parse(row.cards); } catch {}
  cards.unshift(entry);
  const now = new Date().toISOString();
  getDb().prepare('UPDATE user_projects SET cards = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(cards), now, row.id);
  res.status(201).json({ project: rowToProject({ ...row, cards: JSON.stringify(cards), updatedAt: now }), card: entry });
});

router.delete('/:id/cards/:cardId', (req, res) => {
  const row = ownedProject(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  let cards = []; try { cards = JSON.parse(row.cards); } catch {}
  const before = cards.length;
  cards = cards.filter((c) => c.id !== req.params.cardId);
  if (cards.length === before) return res.status(404).json({ error: 'card not found' });
  const now = new Date().toISOString();
  getDb().prepare('UPDATE user_projects SET cards = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(cards), now, row.id);
  res.json({ project: rowToProject({ ...row, cards: JSON.stringify(cards), updatedAt: now }) });
});

module.exports = router;
