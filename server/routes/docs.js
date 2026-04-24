'use strict';
const express = require('express');
const store = require('../services/docsStore');
const requireUser = require('../middleware/requireUser');

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

module.exports = router;
