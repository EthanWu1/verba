'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DATA_PATH = path.resolve(__dirname, '..', 'data', 'projects.json');

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); } catch { return []; }
}
function save(data) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

// GET /api/projects
router.get('/', (_req, res) => {
  res.json({ items: load() });
});

// POST /api/projects   { name }
router.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const color = String(req.body?.color || '#6B7280').slice(0, 9);
  const project = {
    id: randomUUID(),
    name,
    color,
    cards: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const all = load();
  all.unshift(project);
  save(all);
  res.status(201).json({ project });
});

// PATCH /api/projects/:id   { name }
router.patch('/:id', (req, res) => {
  const all = load();
  const p = all.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (req.body?.name) p.name = String(req.body.name).trim();
  if (req.body?.color) p.color = String(req.body.color).slice(0, 9);
  p.updatedAt = new Date().toISOString();
  save(all);
  res.json({ project: p });
});

// DELETE /api/projects/:id
router.delete('/:id', (req, res) => {
  const all = load();
  const next = all.filter((p) => p.id !== req.params.id);
  if (next.length === all.length) return res.status(404).json({ error: 'Not found' });
  save(next);
  res.json({ ok: true });
});

// POST /api/projects/:id/cards   { card }
router.post('/:id/cards', (req, res) => {
  const all = load();
  const p = all.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const card = req.body?.card || {};
  if (!card.tag && !card.body_markdown && !card.body_plain) return res.status(400).json({ error: 'card requires tag or body' });
  const entry = { id: card.id || randomUUID(), ...card, addedAt: new Date().toISOString() };
  p.cards = p.cards || [];
  p.cards.unshift(entry);
  p.updatedAt = new Date().toISOString();
  save(all);
  res.status(201).json({ project: p, card: entry });
});

// DELETE /api/projects/:id/cards/:cardId
router.delete('/:id/cards/:cardId', (req, res) => {
  const all = load();
  const p = all.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const before = (p.cards || []).length;
  p.cards = (p.cards || []).filter((c) => c.id !== req.params.cardId);
  if (p.cards.length === before) return res.status(404).json({ error: 'card not found' });
  p.updatedAt = new Date().toISOString();
  save(all);
  res.json({ project: p });
});

module.exports = router;
