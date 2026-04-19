'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DATA_PATH = path.resolve(__dirname, '..', 'data', 'contentions.json');

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); } catch { return []; }
}

function save(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

// GET /api/contentions — all, or ?topic=X to filter
router.get('/', (req, res) => {
  const all = load();
  const { topic } = req.query;
  const filtered = topic ? all.filter(c => c.topic?.toUpperCase() === topic.toUpperCase()) : all;

  if (!topic) {
    // Return grouped by topic with counts
    const groups = {};
    for (const c of all) {
      const t = (c.topic || 'GENERAL').toUpperCase();
      if (!groups[t]) groups[t] = 0;
      groups[t]++;
    }
    return res.json({ groups, items: all });
  }

  res.json({ items: filtered });
});

// POST /api/contentions — create
router.post('/', (req, res) => {
  const { topic, debater, team, body, tags } = req.body;
  if (!topic || !body) return res.status(400).json({ error: 'topic and body are required' });

  const contention = {
    id: randomUUID(),
    topic: topic.toUpperCase().trim(),
    debater: debater || '',
    team: team || '',
    body: body.trim(),
    tags: Array.isArray(tags) ? tags : [],
    createdAt: new Date().toISOString(),
  };

  const all = load();
  all.unshift(contention);
  save(all);
  res.status(201).json({ contention });
});

// DELETE /api/contentions/:id
router.delete('/:id', (req, res) => {
  const all = load();
  const next = all.filter(c => c.id !== req.params.id);
  if (next.length === all.length) return res.status(404).json({ error: 'Not found' });
  save(next);
  res.json({ ok: true });
});

module.exports = router;
