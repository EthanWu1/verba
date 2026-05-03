'use strict';
const express = require('express');
const multer = require('multer');
const requireUser = require('../middleware/requireUser');
const enforceLimit = require('../middleware/enforceLimit');
const store = require('../services/chatStore');

const router = express.Router();
router.use(requireUser);

const CHAT_MONTHLY_LIMIT = Number(process.env.FREE_CHAT_DAILY || 20);

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
    const name = req.file.originalname || 'file';
    const ext = (name.split('.').pop() || '').toLowerCase();
    const mime = (req.file.mimetype || '').toLowerCase();
    let text = '';
    let kind = ext;

    if (ext === 'docx' || mime.includes('officedocument.wordprocessingml')) {
      text = await extractDocxText(req.file.buffer);
      kind = 'docx';
    } else if (ext === 'txt' || mime.startsWith('text/')) {
      text = req.file.buffer.toString('utf8');
      kind = 'txt';
    } else if (ext === 'pdf' || mime === 'application/pdf') {
      text = await extractPdfText(req.file.buffer);
      kind = 'pdf';
    } else {
      return res.status(415).json({ error: 'unsupported_type', message: `Unsupported: .${ext || mime}` });
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const row = store.addContext({
      userId: req.user.id,
      name,
      kind,
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

// Helper: extract text from PDF Buffer. Tries pdf-parse if installed; otherwise stores empty text + length note.
async function extractPdfText(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return String(data.text || '');
  } catch (err) {
    // pdf-parse not installed or failed: TODO add lightweight parser. Store size hint so word count is non-zero.
    const kb = Math.max(1, Math.round(buffer.length / 1024));
    return `[PDF stored, text extraction unavailable] ${kb} KB`;
  }
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
const { CHAT_STYLE_BRIEF, CHAT_FORMATTING_BRIEF } = require('../prompts/chatPatterns');
const { SHORT_BRIEF, pickChatMaxTokens } = require('../prompts/chatBrevity');

// Defaults — chosen by VERIFIED OpenRouter availability + cost/quality:
//   FAST: gemini-2.5-flash — strong reasoning at ~$0.30/$2.50 per 1M; fast TTFT.
//   BLOCK: claude-sonnet-4.6 — confirmed-working Anthropic ID. Haiku-4.6 was
//          rejected by OpenRouter ("not a valid model ID") so we use Sonnet
//          for /block until a verified cheaper Anthropic ID is identified.
// Override either via CHAT_MODEL_FAST / CHAT_MODEL_BLOCK env vars.
const MODEL_FAST  = process.env.CHAT_MODEL_FAST  || 'google/gemini-2.5-flash';
const MODEL_BLOCK = process.env.CHAT_MODEL_BLOCK || 'anthropic/claude-sonnet-4.6';

// Pull selected context docs (full text) so the LLM grounds its answer in the
// user's attached files rather than only the FTS-recalled snippet.
function loadAttachedContext(userId, contextIds) {
  if (!Array.isArray(contextIds) || contextIds.length === 0) return [];
  const { getDb } = require('../services/db');
  const db = getDb();
  const placeholders = contextIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, name, content FROM chat_context WHERE userId = ? AND id IN (${placeholders})`
  ).all(userId, ...contextIds);
  // Cap each doc at 8k chars so a huge upload doesn't blow the prompt.
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    content_plain: String(r.content || '').slice(0, 8000),
  }));
}

// Pull the prior turns of this thread so the assistant has conversational
// memory. Cap at the most recent ~10 messages to keep prompt small.
function loadPriorTurns(threadId, currentUserMsgId) {
  const all = store.listMessages(threadId);
  return all
    .filter(m => m.id !== currentUserMsgId)
    .slice(-10)
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));
}

async function maybeRenameThread(threadId, userId, firstUserMsg) {
  // Only auto-rename a fresh (nameSet=0) thread. Once it's named — either by
  // the AI or by the user manually — we never overwrite. After the rename
  // succeeds we mark nameSet=1 which makes the thread visible in the picker.
  // If the AI call fails, we still flip nameSet=1 with a sane fallback title
  // so the thread doesn't get permanently hidden from the user.
  const t = store.getThread(threadId, userId);
  if (!t || t.nameSet === 1) return;
  let title = '';
  try {
    const r = await complete({
      messages: [
        { role: 'system', content: 'Generate a SHORT thread title (2-6 words, no quotes, no punctuation at end) summarizing the user\'s message. Reply with the title only.' },
        { role: 'user', content: firstUserMsg.slice(0, 600) },
      ],
      temperature: 0.2,
      maxTokens: 24,
      forceModel: MODEL_FAST,
    });
    title = String(r.content || '').trim().replace(/^["'`]|["'`]$/g, '').slice(0, 60);
  } catch { /* fall through to fallback */ }
  if (!title) title = firstUserMsg.slice(0, 60).trim() || 'New thread';
  store.markThreadNamed(threadId, userId, title);
}

router.post('/threads/:id/messages', enforceLimit('chat', CHAT_MONTHLY_LIMIT), async (req, res) => {
  const userId = req.user.id;
  const threadId = req.params.id;
  const thread = store.getThread(threadId, userId);
  if (!thread) return res.status(404).json({ error: 'not_found' });

  const content = String((req.body && req.body.content) || '').trim();
  if (!content) return res.status(400).json({ error: 'content_required' });
  const contextIds = Array.isArray(req.body && req.body.contextIds) ? req.body.contextIds : [];

  const parsed = parseCommand(content);
  const userMsg = store.addMessage(threadId, 'user', content, { command: parsed.command });
  const isFirstMessage = store.listMessages(threadId).filter(m => m.role === 'user').length === 1;
  const priorTurns = loadPriorTurns(threadId, userMsg.id);
  const attachedDocs = loadAttachedContext(userId, contextIds);

  // /block → non-streaming JSON
  if (parsed.command === '/block') {
    try {
      const [cards, analytics] = await Promise.all([
        retrieval.retrieveCards(parsed.intent, 10),
        retrieval.retrieveAnalytics(parsed.intent, 5),
      ]);
      const prompt = buildBlockPrompt({ intent: parsed.intent, cards, analytics, contextDocs: attachedDocs });
      const blockSystem = [
        'You are a competitive debate assistant. Reply with valid JSON only.',
        CHAT_STYLE_BRIEF,
        CHAT_FORMATTING_BRIEF,
      ].join('\n\n');
      const raw = await complete({
        messages: [
          { role: 'system', content: blockSystem },
          ...priorTurns,
          { role: 'user', content: prompt },
        ],
        forceModel: MODEL_BLOCK,
        temperature: 0.2,
        maxTokens: 1200,
      });
      let block = {};
      try { block = parseJSON(raw.content) || {}; } catch { block = {}; }
      const asstMsg = store.addMessage(threadId, 'assistant', 'Block generated.', {
        command: '/block',
        blockJson: { ...block, candidateCards: cards },
      });
      // Wait for rename so the response includes the named thread — without
      // this, the client polls listThreads and sees nothing (nameSet still 0)
      // until the next render cycle.
      if (isFirstMessage) await maybeRenameThread(threadId, userId, content);
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
    const analytics = await retrieval.retrieveAnalytics(parsed.intent, isAnalytic ? 8 : 10);
    const userPrompt = isAnalytic
      ? buildAnalyticPrompt({ intent: parsed.intent, analytics, contextDocs: attachedDocs })
      : buildExplainPrompt({ intent: parsed.intent, context: analytics, contextDocs: attachedDocs });

    const baseSystem = 'You are Verba, a competitive debate assistant. You have access to the user\'s uploaded context documents — when they\'re provided, ground your answer in them. Maintain conversational continuity across the thread\'s prior turns.';
    // Plain-prose chat: only voice/brevity rules. CHAT_FORMATTING_BRIEF is
    // /block-only — it carries debate-document markup conventions that don't
    // belong in a chat reply (chat UI shows raw ** / <u> chars).
    const fullSystem = [baseSystem, SHORT_BRIEF, CHAT_STYLE_BRIEF].join('\n\n');
    const messages = [
      { role: 'system', content: fullSystem },
      ...priorTurns,
      { role: 'user', content: userPrompt },
    ];

    res.write('event: start\ndata: ' + JSON.stringify({ userMessageId: userMsg.id }) + '\n\n');

    let full = '';
    const chatChain = [MODEL_FAST, MODEL_BLOCK].filter((v, i, a) => a.indexOf(v) === i);
    let lastErr = null;
    // Brevity-aware budget: short by default (~220 tok), expand when the
    // user asks for a block / frontline / overview / extension. Keeps
    // single-question answers from sprawling without capping legitimate
    // long-form requests.
    const chatMaxTokens = pickChatMaxTokens(content);
    for (const m of chatChain) {
      try {
        await completeStream({
          messages,
          forceModel: m,
          temperature: 0.4,
          maxTokens: chatMaxTokens,
          onToken: (tok) => {
            full += tok;
            res.write('event: token\ndata: ' + JSON.stringify({ t: tok }) + '\n\n');
          },
        });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        full = '';
        console.warn(`[chat] ${m} failed, trying next:`, e.message);
      }
    }
    if (lastErr) throw lastErr;
    const asstMsg = store.addMessage(threadId, 'assistant', full, { command: parsed.command });
    // Run rename BEFORE the done event so the client's refreshThreadTitle()
    // (which fires on done) hits a server state that already exposes the
    // newly-named thread via listThreads. ~500-1500ms added latency between
    // the last token and "stream complete" — acceptable since the user can
    // already read the streamed reply.
    if (isFirstMessage) await maybeRenameThread(threadId, userId, content);
    res.write('event: done\ndata: ' + JSON.stringify({ assistantMessageId: asstMsg.id }) + '\n\n');
    res.end();
  } catch (err) {
    res.write('event: error\ndata: ' + JSON.stringify({ message: err.message || 'chat failed' }) + '\n\n');
    res.end();
  }
});

module.exports = router;
