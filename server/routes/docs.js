'use strict';
const express = require('express');
const store = require('../services/docsStore');
const requireUser = require('../middleware/requireUser');
const { htmlToDocxBuffer } = require('../services/docsExport');
const ai = require('../services/docsAI');
const { complete, parseJSON } = require('../services/llm');

const router = express.Router();
router.use(requireUser);

router.get('/', (req, res) => {
  res.json({ docs: store.listDocs(req.user.id) });
});

router.get('/:id', (req, res) => {
  const doc = store.getDoc(req.params.id, req.user.id);
  if (!doc) return res.status(404).json({ error: 'not_found' });
  res.json({ doc });
});

router.post('/', (req, res) => {
  const { kind, name, parentId = null, contentHtml = null } = req.body || {};
  if (!kind || !name) return res.status(400).json({ error: 'kind_and_name_required' });
  if (kind !== 'folder' && kind !== 'file') return res.status(400).json({ error: 'bad_kind' });
  const doc = store.createDoc({ userId: req.user.id, kind, name, parentId, contentHtml });
  res.json({ doc });
});

router.patch('/:id', (req, res) => {
  const existing = store.getDoc(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const doc = store.updateDoc(req.params.id, req.user.id, req.body || {});
  res.json({ doc });
});

router.delete('/:id', (req, res) => {
  store.deleteDoc(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.post('/:id/export', async (req, res) => {
  const doc = store.getDoc(req.params.id, req.user.id);
  if (!doc || doc.kind !== 'file') return res.status(404).json({ error: 'not_found' });
  try {
    const buf = await htmlToDocxBuffer(doc.contentHtml || '');
    const safeName = (doc.name || 'doc').replace(/[^\w.-]+/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: 'export_failed', message: err.message });
  }
});

const AI_MODEL_BLOCK = 'deepseek/deepseek-chat';
const AI_MODEL_ANALYTIC = 'deepseek/deepseek-chat';

async function runLLM(prompt, model) {
  const raw = await complete({ prompt, forceModel: model });
  return parseJSON(raw);
}

router.post('/ai/card-search', async (req, res) => {
  const q = String(req.body?.q || '').trim();
  const k = Math.min(25, Number(req.body?.k) || 10);
  if (!q) return res.json({ cards: [] });
  try {
    const cards = await ai.retrieveCards(q, k);
    res.json({ cards });
  } catch (err) {
    res.status(500).json({ error: 'search_failed', message: err.message });
  }
});

router.post('/ai/block', async (req, res) => {
  const { intent, headings = {} } = req.body || {};
  if (!intent) return res.status(400).json({ error: 'intent_required' });
  try {
    const query = [intent, headings.h1, headings.h2, headings.h3].filter(Boolean).join(' ');
    const cards     = await ai.retrieveCards(query, 10);
    const analytics = await ai.retrieveAnalytics(query, 5);
    const prompt    = ai.buildBlockPrompt({ intent, headings, cards, analytics });
    const out       = await runLLM(prompt, AI_MODEL_BLOCK);
    if (!out || typeof out !== 'object') return res.status(502).json({ error: 'bad_llm_response' });
    res.json({ ...out, candidateCards: cards });
  } catch (err) {
    res.status(500).json({ error: 'block_failed', message: err.message });
  }
});

router.post('/ai/analytic', async (req, res) => {
  const { intent, headings = {} } = req.body || {};
  if (!intent) return res.status(400).json({ error: 'intent_required' });
  try {
    const query     = [intent, headings.h1, headings.h2, headings.h3].filter(Boolean).join(' ');
    const analytics = await ai.retrieveAnalytics(query, 10);
    const prompt    = ai.buildAnalyticPrompt({ intent, headings, analytics });
    const out       = await runLLM(prompt, AI_MODEL_ANALYTIC);
    if (!out || typeof out !== 'object') return res.status(502).json({ error: 'bad_llm_response' });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: 'analytic_failed', message: err.message });
  }
});

module.exports = router;
