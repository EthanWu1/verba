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

const { parseCommand, buildExplainPrompt, buildAnalyticPrompt, buildBlockPrompt } = require('../services/chatCommands');
const retrieval = require('../services/chatRetrieval');
const { complete, completeStream, parseJSON } = require('../services/llm');

const MODEL_FAST  = 'google/gemini-2.5-flash-lite';
const MODEL_BLOCK = 'deepseek/deepseek-chat';

router.post('/threads/:id/messages', async (req, res) => {
  const userId = req.user.id;
  const threadId = req.params.id;
  const thread = store.getThread(threadId, userId);
  if (!thread) return res.status(404).json({ error: 'not_found' });

  const content = String((req.body && req.body.content) || '').trim();
  if (!content) return res.status(400).json({ error: 'content_required' });

  const parsed = parseCommand(content);
  const userMsg = store.addMessage(threadId, 'user', content, { command: parsed.command });

  // /block → non-streaming JSON
  if (parsed.command === '/block') {
    try {
      const [cards, analytics, userCtx] = await Promise.all([
        retrieval.retrieveCards(parsed.intent, 10),
        retrieval.retrieveAnalytics(parsed.intent, 5),
        retrieval.retrieveUserContext(userId, parsed.intent, 3),
      ]);
      const prompt = buildBlockPrompt({ intent: parsed.intent, cards, analytics, contextDocs: userCtx });
      const raw = await complete({ prompt, forceModel: MODEL_BLOCK });
      const block = parseJSON(raw) || {};
      const asstMsg = store.addMessage(threadId, 'assistant', 'Block generated.', {
        command: '/block',
        blockJson: { ...block, candidateCards: cards },
      });
      return res.json({ userMessage: userMsg, assistantMessage: asstMsg });
    } catch (err) {
      const errMsg = store.addMessage(threadId, 'assistant', 'Block generation failed: ' + err.message);
      return res.status(500).json({ userMessage: userMsg, assistantMessage: errMsg });
    }
  }

  // /explain or /analytic or plain → SSE stream
  const isAnalytic = parsed.command === '/analytic';
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  try {
    const [analytics, userCtx] = await Promise.all([
      retrieval.retrieveAnalytics(parsed.intent, isAnalytic ? 8 : 10),
      retrieval.retrieveUserContext(userId, parsed.intent, 3),
    ]);
    const prompt = isAnalytic
      ? buildAnalyticPrompt({ intent: parsed.intent, analytics, contextDocs: userCtx })
      : buildExplainPrompt({ intent: parsed.intent, context: analytics, contextDocs: userCtx });

    res.write('event: start\ndata: ' + JSON.stringify({ userMessageId: userMsg.id }) + '\n\n');

    let full = '';
    await completeStream({
      prompt,
      forceModel: MODEL_FAST,
      onToken: (tok) => {
        full += tok;
        res.write('event: token\ndata: ' + JSON.stringify({ t: tok }) + '\n\n');
      },
    });
    const asstMsg = store.addMessage(threadId, 'assistant', full, { command: parsed.command });
    res.write('event: done\ndata: ' + JSON.stringify({ assistantMessageId: asstMsg.id }) + '\n\n');
    res.end();
  } catch (err) {
    res.write('event: error\ndata: ' + JSON.stringify({ message: err.message }) + '\n\n');
    res.end();
  }
});

module.exports = router;
