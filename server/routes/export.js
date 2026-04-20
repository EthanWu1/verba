'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { buildDocx, buildProjectDocx } = require('../services/docxBuilder');

const PROJECTS_PATH = path.resolve(__dirname, '..', 'data', 'projects.json');
function loadProjects() {
  try { return JSON.parse(fs.readFileSync(PROJECTS_PATH, 'utf8')); } catch { return []; }
}

router.post('/', async (req, res) => {
  const {
    pocket = '',
    hat = '',
    block = '',
    tag = '',
    cite = '',
    body_markdown = '',
    body_html = '',
    filename,
  } = req.body;

  if (!tag && !body_markdown && !body_html) {
    return res.status(400).json({ error: 'At least tag or body content is required to export.' });
  }

  let buffer;
  try {
    buffer = await buildDocx({ pocket, hat, block, tag, cite, body_markdown, body_html });
  } catch (error) {
    console.error('[export] docx build error:', error.message);
    return res.status(500).json({ error: 'Failed to build .docx: ' + error.message });
  }

  const citeStr = String(cite || '').replace(/^\[[^\]]*\]\s*/, '').trim();
  const STOP = new Set(['et','al','the','and','dr','mr','mrs','ms','prof','von','van','de','del','la']);
  let lastName = '';
  for (const tok of citeStr.split(/[\s,.;:()\[\]]+/)) {
    const m = tok.match(/^([A-Za-z][A-Za-z'\-]{1,})$/);
    if (!m) continue;
    if (STOP.has(m[1].toLowerCase())) continue;
    lastName = m[1];
    break;
  }
  const yearMatch = citeStr.match(/\b(?:19|20)(\d{2})\b/) || citeStr.match(/'?(\d{2})\b/);
  let outFile;
  if (filename) {
    outFile = filename;
  } else if (lastName && yearMatch) {
    const yy = yearMatch[1];
    outFile = `${lastName.replace(/[^a-zA-Z0-9\-]/g, '')} ${yy}.docx`;
  } else if (lastName) {
    outFile = `${lastName.replace(/[^a-zA-Z0-9\-]/g, '')}.docx`;
  } else {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    outFile = `Card ${mm}-${dd}.docx`;
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${outFile}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
});

router.post('/project', async (req, res) => {
  const { projectId } = req.body || {};
  if (!projectId) return res.status(400).json({ error: 'projectId required' });

  const project = loadProjects().find((p) => p.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const cards = project.cards || [];
  if (!cards.length) return res.status(400).json({ error: 'Project has no cards' });

  let buffer;
  try {
    buffer = await buildProjectDocx(project.name, cards);
  } catch (error) {
    console.error('[export/project] docx build error:', error.message);
    return res.status(500).json({ error: 'Failed to build project docx: ' + error.message });
  }

  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const safeName = (project.name || '').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();
  const outFile = safeName ? `${safeName} ${mm}-${dd}.docx` : `Project ${mm}-${dd}.docx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${outFile}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
});

module.exports = router;
