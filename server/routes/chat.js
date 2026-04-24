'use strict';
const express = require('express');
const multer = require('multer');
const requireUser = require('../middleware/requireUser');
const store = require('../services/chatStore');

const router = express.Router();
router.use(requireUser);

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } });

// Threads
router.get('/threads', (req, res) => {
  const includeArchived = req.query.archived === '1';
  res.json({ threads: store.listThreads(req.user.id, { includeArchived }) });
});
router.post('/threads', (req, res) => {
  const t = store.createThread(req.user.id, (req.body && req.body.title) || 'New thread');
  res.json({ thread: t });
});
router.patch('/threads/:id', (req, res) => {
  const t = store.updateThread(req.params.id, req.user.id, req.body || {});
  if (!t) return res.status(404).json({ error: 'not_found' });
  res.json({ thread: t });
});
router.delete('/threads/:id', (req, res) => {
  store.deleteThread(req.params.id, req.user.id);
  res.json({ ok: true });
});

// Messages (list only; POST is Task 6)
router.get('/threads/:id/messages', (req, res) => {
  const t = store.getThread(req.params.id, req.user.id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  res.json({ messages: store.listMessages(req.params.id) });
});

// Context
router.get('/context', (req, res) => {
  res.json({ context: store.listContext(req.user.id) });
});
router.post('/context', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  try {
    const text = await extractDocxText(req.file.buffer);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const row = store.addContext({
      userId: req.user.id,
      name: req.file.originalname,
      kind: 'docx',
      wordCount,
      content: text,
    });
    res.json({ context: row });
  } catch (err) {
    res.status(500).json({ error: 'extract_failed', message: err.message });
  }
});
router.delete('/context/:id', (req, res) => {
  store.deleteContext(req.params.id, req.user.id);
  res.json({ ok: true });
});

// Helper: extract plain text from docx Buffer using inline minimal extraction
async function extractDocxText(buffer) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const xmlFile = zip.file('word/document.xml');
  if (!xmlFile) throw new Error('no_document_xml');
  const xml = await xmlFile.async('text');
  const texts = [];
  const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    texts.push(decodeXml(m[1]));
  }
  return texts.join(' ');
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

module.exports = router;
