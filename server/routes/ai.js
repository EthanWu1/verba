/**
 * routes/ai.js
 * Instant-first retrieval and card cutting routes
 */

'use strict';

const express = require('express');
const router = express.Router();
const requireUser = require('../middleware/requireUser');
const enforceLimit = require('../middleware/enforceLimit');
const CUT_DAILY_LIMIT = Number(process.env.FREE_CUTCARD_DAILY || 5);

const { complete, completeStream, completeJSON: llmCompleteJSON, parseJSON, smartTruncate, getTokenStats, MODEL_CHAIN } = require('../services/llm');
const { SYSTEM_PROMPT, buildSystemPrompt, buildCutPrompt, buildEditPrompt, LENGTH_PRESETS, DENSITY_PRESETS } = require('../prompts/cardCutter');
const { getCalibration, buildCalibrationSnippet } = require('../services/cutterCalibration');
const { cutCardV2 } = require('../services/cutCardV2');

const LENGTH_BUDGETS = {
  short:  { input: 6000,  output: 2600 },
  medium: { input: 9000,  output: 4500 },
  long:   { input: 16000, output: 8000 },
};
// Defaults: 'standard' density (60–75% underline) gives plenty of read-aloud
// context; 'long' length keeps generous paragraph counts so the warrant has
// room to breathe.
function normalizeDensity(v) { return DENSITY_PRESETS[v] ? v : 'standard'; }
function normalizeLength(v)  { return LENGTH_PRESETS[v]  ? v : 'long'; }
const { validateCut } = require('../services/cutValidator');
const { buildChatContext } = require('../services/libraryQuery');
const { buildCite, validateCiteMatchesMeta } = require('../services/autocite');
const {
  findBestResearchSource,
  buildInstantLibraryBullets,
} = require('../services/instantResearch');
const { reachable } = require('../services/urlCheck');
const fileCache = require('../services/fileCache');
const { saveCutCardForUser } = require('../services/autoSaveCard');

// Card cutting on Haiku 4.5 by default. The server-side enforcement layer
// (enforceParagraphIntegrity + autoFormatFromSource) cleans up any
// shortcomings rather than escalating to a more expensive model.
// CARD_CUT_FALLBACK_MODEL exists for env override but is no longer wired
// into the cut flow.
const CARD_CUT_MODEL          = process.env.CARD_CUT_MODEL          || 'claude-haiku-4-5';
const CARD_CUT_FALLBACK_MODEL = process.env.CARD_CUT_FALLBACK_MODEL || 'claude-haiku-4-5';

// Detect refusal / hedge text in raw model output so we can escalate even
// when JSON parsing technically succeeded but the body is empty or apologetic.
function isLikelyHedge(content) {
  if (!content) return true;
  const t = String(content).toLowerCase();
  return /\b(i (cannot|can't|am unable)|sorry|as an ai|i'?m unable|cannot produce|refuse)\b/.test(t)
      || t.length < 80;
}

function stripFormatMarks(md) {
  return String(md || '')
    .replace(/\*\*<u>([\s\S]*?)<\/u>\*\*/g, '$1')
    .replace(/<u>([\s\S]*?)<\/u>/g, '$1')
    .replace(/==([\s\S]*?)==/g, '$1')
    .replace(/\u00B6/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalize for fidelity comparison: smart quotes → straight, em/en/figure
// dash → hyphen, NBSP → space, lowercase, collapse whitespace. Without this,
// Sonnet routinely produces output where every word is verbatim but Unicode
// substitution makes the naive comparator fail (e.g. " vs " in the source).
function normalizeForCompare(s) {
  return String(s || '')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/[  ]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Highlight-quality enforcement. The 5-word target is a rule of thumb in the
// prompt — we DO NOT truncate at the server. The only hard rule we enforce
// is structural: highlights must sit inside <u>…</u>. Long-but-valid clauses
// pass through unchanged; bare ==highlight== outside an underline gets
// unwrapped (text preserved, markup stripped).
// Heuristic auto-format fallback. When the model emits zero markup (just
// raw paragraphs) we generate a serviceable card by wrapping each picked
// source paragraph in <u>…</u> and inserting ==…== highlights around the
// highest-signal phrases (numbers, finite verbs, named entities, leading
// subject). Output is still 100% verbatim source text — better than a
// formatless raw dump.
function autoFormatFromSource(sourceText, modelPickedTexts = null) {
  const paras = String(sourceText || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (!paras.length) return '';

  // If model picked some paragraphs (just paraphrased), match them back to
  // source by token overlap so we use exactly the source paragraphs the
  // model intended. Otherwise fall back to the first 8 source paragraphs.
  let target;
  if (modelPickedTexts && modelPickedTexts.length) {
    const used = new Set();
    target = [];
    for (const mp of modelPickedTexts) {
      const mTokens = new Set(normalizeForCompare(mp).split(' ').filter(w => w.length > 3));
      let bestIdx = -1, bestScore = 0;
      for (let i = 0; i < paras.length; i++) {
        if (used.has(i)) continue;
        const sTokens = new Set(normalizeForCompare(paras[i]).split(' ').filter(w => w.length > 3));
        const overlap = [...mTokens].filter(t => sTokens.has(t)).length;
        const score = overlap / Math.max(1, mTokens.size);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
      if (bestIdx >= 0 && bestScore >= 0.20) {
        used.add(bestIdx);
        target.push(paras[bestIdx]);
      }
    }
    if (!target.length) target = paras.slice(0, Math.min(8, paras.length));
  } else {
    target = paras.slice(0, Math.min(8, paras.length));
  }

  const VERB = /\b(?:causes?|caused|leads?\s+to|led\s+to|triggers?|triggered|prevents?|undermines?|undermined|destroys?|destroyed|drives?|drove|increases?|increased|reduces?|reduced|threatens?|threatened|guarantees?|guaranteed|locks?\s+in|locked\s+in|ends?|ended|eliminates?|eliminated|results?\s+in|resulted\s+in|enables?|enabled|forces?|forced|requires?|required|creates?|created|breaks?\s+down|broke\s+down|fails?|failed|collapses?|collapsed)\b/i;
  const NUM  = /\b(?:\d+(?:[.,]\d+)?(?:%|\s*(?:billion|million|trillion|thousand|years?|decades?))?|by\s+\d{4}|in\s+\d{4}|\d{4})\b/;
  const ENT  = /\b(?:U\.?S\.?A?\.?|United\s+States|China|Russia|India|Iran|NATO|U\.?N\.?|E\.?U\.?|IPCC|Putin|Biden|Trump|Xi|Arctic|Pacific|Atlantic|Israel|Korea|Japan)\b/;

  const formatted = target.map(p => {
    let body = p;
    const ranges = [];
    const addMatch = (re, scope) => {
      const local = scope ? scope : body;
      const m = local.match(re);
      if (m && typeof m.index === 'number') {
        const start = m.index, end = start + m[0].length;
        if (!ranges.some(r => !(end <= r.start || start >= r.end))) ranges.push({ start, end });
      }
    };
    addMatch(NUM);
    addMatch(VERB);
    addMatch(ENT);
    if (!ranges.length) {
      const m = body.match(/^([A-Z][\w'-]*(?:\s+[A-Za-z][\w'-]*){0,2})/);
      if (m) ranges.push({ start: 0, end: m[0].length });
    }
    ranges.sort((a, b) => b.start - a.start);
    for (const r of ranges) {
      body = body.slice(0, r.start) + '==' + body.slice(r.start, r.end) + '==' + body.slice(r.end);
    }
    return `<u>${body}</u>`;
  });
  return formatted.join('\n\n');
}

// Quick check for "did the model produce ANY markup at all?"
function hasUsableMarkup(bodyMd) {
  const s = String(bodyMd || '');
  const uCount = (s.match(/<u>/g) || []).length;
  return uCount >= 2;   // need at least 2 underlines to call it formatted
}

function enforceHighlightDiscipline(bodyMd) {
  if (!bodyMd) return bodyMd;
  let s = String(bodyMd);

  // Identify <u>…</u> spans across the WHOLE body (highlights are allowed
  // to flow across paragraphs as long as each one sits inside an underline).
  const uRanges = [];
  const uRe = /<u>[\s\S]*?<\/u>/g;
  let m;
  while ((m = uRe.exec(s)) !== null) {
    uRanges.push({ start: m.index, end: m.index + m[0].length });
  }
  if (!uRanges.length) {
    // No underlines anywhere — strip every highlight (markers only).
    return s.replace(/==([^=\n]+?)==/g, '$1');
  }
  return s.replace(/==([^=\n]+?)==/g, (full, inner, idx) => {
    const innerStart = idx + 2;
    const innerEnd = idx + full.length - 2;
    const insideU = uRanges.some(r => innerStart >= r.start && innerEnd <= r.end);
    return insideU ? full : inner;
  });
}

// Paragraph-integrity enforcement — server is the source of truth for the
// body text. For each paragraph the model emitted, find its best-matching
// SOURCE paragraph by token overlap, replace the paragraph with that source
// text VERBATIM, and re-anchor the model's highlight / bold / underline
// marks by phrase-matching them against the verbatim text. Anything the
// model paraphrased gets thrown out; the source wins. Returns null if no
// good matches found, otherwise the rebuilt body_markdown.
function enforceParagraphIntegrity(modelBodyMd, sourceText) {
  if (!modelBodyMd || !sourceText) return null;
  const sourceParas = String(sourceText).split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (!sourceParas.length) return null;
  const modelParas = String(modelBodyMd).split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (!modelParas.length) return null;

  const tokenize = (s) => normalizeForCompare(s).split(' ').filter(w => w.length > 3);
  const sourceTokenSets = sourceParas.map(p => new Set(tokenize(p)));

  // Track which source paragraphs already used so each appears at most once
  // (preserves "complete source paragraph" rule and prevents duplication).
  const usedSourceIdx = new Set();
  const out = [];

  for (const mp of modelParas) {
    const mpPlain = stripFormatMarks(mp);
    const mpTokens = new Set(tokenize(mpPlain));
    if (mpTokens.size < 4) continue;     // skip tiny noise paragraphs

    // Find source paragraph with highest token overlap.
    let bestIdx = -1, bestScore = 0;
    for (let i = 0; i < sourceParas.length; i++) {
      if (usedSourceIdx.has(i)) continue;
      const overlap = [...mpTokens].filter(t => sourceTokenSets[i].has(t)).length;
      const score = overlap / mpTokens.size;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    // Lowered from 0.35 → 0.20: when the model paraphrases heavily, the bag-
    // of-tokens overlap drops below 0.35 even though the model is clearly
    // pointing at one specific source paragraph. We don't lose verbatim
    // safety here — reapplyMarks always uses the SOURCE paragraph verbatim;
    // the model output only contributes the markup positions. A wrong match
    // would just produce a paragraph with weaker highlights, not paraphrased
    // text. Better that than silently dropping half the card.
    if (bestIdx === -1 || bestScore < 0.20) continue;
    usedSourceIdx.add(bestIdx);
    const srcPara = sourceParas[bestIdx];

    // Re-anchor the model's marks onto the verbatim source paragraph.
    out.push(reapplyMarks(mp, srcPara));
  }

  return out.length ? out.join('\n\n') : null;
}

// Given a model-emitted paragraph (which may contain ==highlight==, **bold**,
// <u>underline</u> markup but possibly paraphrased text) and the canonical
// SOURCE paragraph (verbatim), produce a marked-up version of the SOURCE
// paragraph by phrase-matching each marked span back into the source.
function reapplyMarks(modelPara, srcPara) {
  // Extract the marked phrases from model output (in the order they appeared).
  // Each entry: { kind: 'h'|'b'|'u', text: <plain>, startInPlain }
  const marks = [];
  const re = /<u>([\s\S]+?)<\/u>|\*\*([^*\n]+?)\*\*|==([^=\n]+?)==/g;
  let m;
  while ((m = re.exec(modelPara)) !== null) {
    if (m[1]) marks.push({ kind: 'u', text: stripFormatMarks(m[1]) });
    else if (m[2]) marks.push({ kind: 'b', text: stripFormatMarks(m[2]) });
    else if (m[3]) marks.push({ kind: 'h', text: stripFormatMarks(m[3]) });
  }
  if (!marks.length) return srcPara;

  // For each mark, find its phrase in the source paragraph (case-insensitive,
  // whitespace-tolerant). Build a list of [start, end, kind] insertions.
  const srcLower = srcPara.toLowerCase();
  const insertions = [];
  for (const mk of marks) {
    const phrase = String(mk.text || '').trim();
    if (!phrase || phrase.length < 4) continue;
    const idx = srcLower.indexOf(phrase.toLowerCase());
    if (idx === -1) continue;
    insertions.push({ start: idx, end: idx + phrase.length, kind: mk.kind });
  }
  if (!insertions.length) return srcPara;

  // Sort by start, then by widest span first (so an outer underline wraps an
  // inner highlight rather than splitting it).
  insertions.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  // Layer the marks. Underlines wrap the outer span; bolds + highlights live
  // inside underlines. Simple non-overlapping pass: greedily apply marks left
  // to right; skip any that would overlap an already-applied mark.
  const taken = []; // ranges already wrapped
  const overlapsTaken = (s, e) => taken.some(t => !(e <= t.start || s >= t.end));
  let result = srcPara;
  // Apply from RIGHT to LEFT so character indices remain stable as we splice.
  const sorted = insertions.slice().sort((a, b) => b.start - a.start);
  for (const ins of sorted) {
    if (overlapsTaken(ins.start, ins.end)) continue;
    taken.push({ start: ins.start, end: ins.end });
    const open  = ins.kind === 'h' ? '==' : ins.kind === 'b' ? '**' : '<u>';
    const close = ins.kind === 'h' ? '==' : ins.kind === 'b' ? '**' : '</u>';
    result = result.slice(0, ins.start) + open + result.slice(ins.start, ins.end) + close + result.slice(ins.end);
  }
  return result;
}

function verifyBodyFidelity(cardBody, sourceText) {
  const plain = normalizeForCompare(stripFormatMarks(cardBody));
  const source = normalizeForCompare(sourceText);
  if (!plain || !source) return { ok: false, missing: [] };

  const words = plain.split(/\s+/).filter(Boolean);
  const windows = [];
  for (let i = 0; i + 5 <= words.length; i += 3) {
    windows.push(words.slice(i, i + 5).join(' '));
  }
  const missing = windows.filter(w => !source.includes(w));
  const matchRate = windows.length ? 1 - missing.length / windows.length : 0;
  return {
    // 0.95 instead of 0.98: tolerates a handful of Unicode/punctuation diffs
    // the model can't avoid (e.g. ligatures, ellipsis, soft hyphen) without
    // letting through actually-paraphrased output.
    ok: matchRate >= 0.95,
    matchRate,
    missing: missing.slice(0, 5),
    totalWindows: windows.length,
  };
}

router.post('/cut-card', requireUser, enforceLimit('cutCard', CUT_DAILY_LIMIT), async (req, res) => {
  const { argument = '', bodyText = '', meta = {}, cite = '' } = req.body;
  const density = normalizeDensity(req.body?.density);
  const length = normalizeLength(req.body?.length);

  if (!bodyText || bodyText.trim().length < 50) {
    return res.status(400).json({ error: 'bodyText must be at least 50 characters.' });
  }

  // V2 pipeline:
  //  - BM25 pre-filter trims article to ~15 candidate paragraphs
  //  - Single LLM call (Haiku 4.5, prompt-cached system, json_schema strict)
  //    emits paragraph indices + word-offset spans, never source text
  //  - Server pulls candidates verbatim and inserts marks at offsets
  // Verbatim and paragraph integrity are guaranteed by construction —
  // no fidelity retries, no validateCut critique, no paragraph rebuilds.
  try {
    const result = await cutCardV2({ argument, bodyText, meta, cite, density, length });
    const { card, model } = result;

    let saved = null;
    try {
      const r = await saveCutCardForUser(req.user?.id, { ...card, ...meta, cite: card.cite || cite });
      if (r) saved = { id: r.card.id, duplicate: r.duplicate, typeLabel: r.card.typeLabel, topicLabel: r.card.topicLabel, argumentTypes: r.card.argumentTypes, argumentTags: r.card.argumentTags };
      if (r && !card.id) card.id = r.card.id;
    } catch {}

    // Compose a "fidelity" object for legacy clients. Verbatim is structural
    // here, so we report ok=true unless the reconstructor used the graceful
    // fallback (model emitted no usable picks → first 2 candidates plain).
    const fidelity = {
      ok: !result.reconstruct.fallback,
      matchRate: 1.0,
      structural: true,
      fallback: result.reconstruct.fallback || false,
    };

    return res.json({
      card,
      fidelity,
      saved,
      stats: result.stats,
      model,
      cached: result.cached,
      reconstruct: result.reconstruct,
    });
  } catch (err) {
    return res.status(502).json({
      error: err.message,
      hint: 'If the model is unavailable, the server retries fallback models automatically.',
      modelsTriied: MODEL_CHAIN,
    });
  }
});

router.post('/edit-card', async (req, res) => {
  const {
    instruction = '',
    argument = '',
    card = {},
    sourceText = '',
    cite = '',
  } = req.body;
  const density = normalizeDensity(req.body?.density);
  const length = normalizeLength(req.body?.length);
  const budget = LENGTH_BUDGETS[length];

  if (!instruction.trim()) {
    return res.status(400).json({ error: 'instruction is required.' });
  }

  if (!card || (!card.body_markdown && !card.tag && !sourceText.trim())) {
    return res.status(400).json({ error: 'A current card or sourceText is required.' });
  }

  const prompt = buildEditPrompt({
    instruction,
    argument,
    card,
    sourceText: smartTruncate(sourceText, Math.min(budget.input, 5000)),
    cite,
    density,
    length,
  });

  try {
    const result = await complete({
      messages: [
        { role: 'system', content: buildSystemPrompt({ density, length }) },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      maxTokens: Math.min(budget.output, 2400),
    });

    let nextCard;
    try {
      nextCard = parseJSON(result.content);
    } catch {
      return res.status(502).json({
        error: 'AI returned malformed JSON during card edit.',
        raw: result.content.slice(0, 400),
      });
    }

    if (!nextCard.body_markdown && !nextCard.tag) {
      return res.status(502).json({
        error: 'Edited card is missing required fields (tag/body_markdown).',
        raw: result.content.slice(0, 300),
      });
    }

    return res.json({ card: nextCard, stats: result.stats, model: result.model });
  } catch (err) {
    return res.status(502).json({
      error: err.message,
      modelsTriied: MODEL_CHAIN,
    });
  }
});

function sanitizeChatOutput(text) {
  return String(text || '')
    .replace(/[—–]/g, '-')
    .replace(/[*_`#>]+/g, '')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildSummaryPrompt(message, context) {
  const cardContext = context.cards.map((card, index) => {
    return [
      `CARD ${index + 1}`,
      `Tag: ${card.tag || 'Untitled'}`,
      `Short Cite: ${card.shortCite || ''}`,
      `Full Cite: ${card.cite || ''}`,
      `Resolution: ${card.resolution || ''}`,
      `Type: ${card.typeLabel || ''}`,
      `Topic: ${card.topicLabel || ''}`,
      `School: ${card.school || ''}`,
      `Canonical: ${card.isCanonical ? 'yes' : 'no'}`,
      `Body: ${smartTruncate(card.body_plain || '', 900)}`,
    ].join('\n');
  }).join('\n\n');

  const analyticsContext = [
    `Total cards: ${context.analytics.totals.cards}`,
    `Canonical cards: ${context.analytics.totals.canonical}`,
    `Schools: ${context.analytics.totals.schools}`,
    `Top resolutions: ${context.analytics.topResolutions.map(item => `${item.label} (${item.count})`).join(', ')}`,
    `Top types: ${context.analytics.topTypes.map(item => `${item.label} (${item.count})`).join(', ')}`,
    `Top topics: ${context.analytics.topTopics.map(item => `${item.label} (${item.count})`).join(', ')}`,
  ].join('\n');

  return [
    'You are a debate research tool. Use only the indexed card data below. Not an AI assistant.',
    '',
    'Rules:',
    '- No greetings or filler.',
    '- Lead with analytics: total cards, top resolutions, dominant types.',
    '- Reference specific cards only when they directly answer the query.',
    '- Use debate terminology: warrants, impacts, blocks, contentions, aff/neg, extensions.',
    '- Bullets only. No prose intro. No closing summary.',
    '- If the data does not support a claim, omit it — do not speculate.',
    '',
    `LIBRARY ANALYTICS:\n${analyticsContext}`,
    '',
    `USER REQUEST: ${String(message).trim()}`,
    '',
    `MATCHED CARDS:\n${cardContext}`,
  ].join('\n');
}

router.post('/chat-library', async (req, res) => {
  const { message = '', filters = {} } = req.body || {};
  if (!String(message).trim()) {
    return res.status(400).json({ error: 'message is required.' });
  }

  const context = await buildChatContext(String(message), filters, 8);
  return res.json({
    answer: buildInstantLibraryBullets(message, context.cards).map(line => `- ${line}`).join('\n'),
    bullets: buildInstantLibraryBullets(message, context.cards),
    cards: context.cards,
    analytics: context.analytics,
    model: 'local-instant',
  });
});

router.post('/chat-library-summary', async (req, res) => {
  const { message = '', filters = {} } = req.body || {};
  if (!String(message).trim()) {
    return res.status(400).json({ error: 'message is required.' });
  }

  const context = await buildChatContext(String(message), filters, 8);
  if (!context.cards.length) {
    return res.json({
      answer: '- The library context is thin for that query.\n- Try a narrower keyword string.',
      cards: [],
      analytics: context.analytics,
      model: 'local-fallback',
    });
  }

  try {
    const result = await complete({
      messages: [
        {
          role: 'system',
          content: 'You are a debate research tool. Use only the card database context below. Output bullets only. Use debate vocabulary. No filler, no AI language, no hedging.',
        },
        { role: 'user', content: buildSummaryPrompt(message, context) },
      ],
      temperature: 0.1,
      maxTokens: 900,
    });

    return res.json({
      answer: sanitizeChatOutput(result.content),
      cards: context.cards,
      analytics: context.analytics,
      stats: result.stats,
      model: result.model,
    });
  } catch (error) {
    return res.json({
      answer: buildInstantLibraryBullets(message, context.cards).map(line => `- ${line}`).join('\n'),
      cards: context.cards,
      analytics: context.analytics,
      model: 'local-fallback',
      warning: error.message,
    });
  }
});

router.get('/research-source-stream', requireUser, enforceLimit('cutCard', CUT_DAILY_LIMIT), async (req, res) => {
  const query = String(req.query.query || '');
  const url = String(req.query.url || '');
  const fileToken = String(req.query.fileToken || '');
  const argument = String(req.query.argument || query || '');
  const density = normalizeDensity(req.query.density);
  const length = normalizeLength(req.query.length);
  const budget = LENGTH_BUDGETS[length];
  // Pull library calibration — globally aggregated patterns from the entire
  // saved-cards table (typical paragraph counts, highlight density, top
  // dropped words, common sentence skeletons). Cached for 1 hour. Skips
  // calibration when the library has fewer than 8 saved cards.
  const calibration = buildCalibrationSnippet(getCalibration());
  const systemPrompt = buildSystemPrompt({ density, length, calibration });

  if (!query.trim() && !url.trim() && !fileToken.trim()) {
    return res.status(400).json({ error: 'A query, URL, or file is required.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    res.write('event: done\ndata: {"ok":true}\n\n');
    res.end();
  };
  const safeStringify = (v) => {
    const seen = new WeakSet();
    try {
      return JSON.stringify(v, (k, val) => {
        if (val instanceof Error) return val.message || String(val);
        if (val && typeof val === 'object') {
          if (seen.has(val)) return '[circular]';
          seen.add(val);
        }
        return val;
      });
    } catch (e) {
      return JSON.stringify({ _unserializable: true, err: e.message });
    }
  };
  const send = (event, data) => {
    if (finished) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${safeStringify(data)}\n\n`);
  };
  const heartbeat = setInterval(() => { if (!finished) res.write(': ping\n\n'); }, 15000);
  const wallClock = setTimeout(() => {
    send('phase', { type: 'timeout', message: 'Cutter timed out after 90s' });
    send('error', { error: 'Cutter timed out after 90s' });
    finish();
  }, 90000);
  req.on('close', () => {
    finished = true;
    clearInterval(heartbeat);
    clearTimeout(wallClock);
  });

  try {
    const onPhase = (p) => send('phase', p);
    let result;
    if (fileToken) {
      const cached = fileCache.get(fileToken);
      if (!cached) {
        send('error', { error: 'Uploaded file expired or not found. Re-upload and try again.' });
        return finish();
      }
      onPhase({ type: 'file_loaded', filename: cached.filename, chars: cached.bodyText.length });
      const paragraphs = cached.bodyText.split(/\n\n+/).filter(p => p.trim().length > 0);
      result = {
        mode: 'file',
        article: {
          title: cached.title,
          author: '',
          date: '',
          source: 'Uploaded file',
          url: '',
          isPdf: /\.pdf$/i.test(cached.filename || ''),
          bodyText: cached.bodyText,
          paragraphs,
        },
        excerpt: cached.bodyText.slice(0, 2000),
        window: { text: cached.bodyText },
        candidates: [],
        lowConfidence: false,
      };
    } else {
      result = await findBestResearchSource({ query, url, onPhase });
    }

    let cite = '';
    let citeData = null;
    try {
      citeData = await buildCite({
        ...result.article,
        doi: result.article.doi || '',
      }, { inferQuals: true });
      cite = citeData.citeString;
    } catch {
      cite = `[No Author] [${result.article.title || result.article.source || 'Source'}${result.article.url ? `; ${result.article.url}` : ''}]`;
    }

    send('source', {
      mode: result.mode,
      article: result.article,
      paragraphs: result.article.paragraphs || [],
      excerpt: result.excerpt,
      window: result.window || null,
      cite,
      citeMeta: citeData ? { hasAuthor: citeData.hasAuthor, hasYear: citeData.hasYear, missing: citeData.missing } : null,
      candidates: result.candidates,
      lowConfidence: Boolean(result.lowConfidence),
    });

    send('phase', { type: 'cut_start' });
    const cutBody = result.window?.text || result.article.bodyText || result.excerpt || '';

    // V2 pipeline — single LLM call, no streaming of source text (picks JSON
    // is tiny). Verbatim and paragraph integrity are structural.
    let v2;
    try {
      v2 = await Promise.race([
        cutCardV2({
          argument,
          bodyText: cutBody,
          cite,
          density,
          length,
          meta: {
            url: result.article.url,
            source: result.article.source,
            title: result.article.title,
            author: result.article.author,
            date: result.article.date,
          },
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('LLM cut timeout 25s')), 25000)),
      ]);
    } catch (cutErr) {
      if (cutErr.message === 'LLM cut timeout 25s') {
        send('phase', { type: 'cut_retry', reason: 'llm-timeout' });
        const partialCard = { tag: result.article.title || 'Untitled', cite, body_markdown: result.excerpt || '' };
        send('card', { card: { ...partialCard, cite: partialCard.cite || cite }, fidelity: { ok: false }, model: 'unknown' });
        send('done', { ok: true });
        return;
      }
      throw cutErr;
    }
    const card = v2.card;
    if (result.article.url && !validateCiteMatchesMeta(card.cite, { url: result.article.url })) {
      card.cite = cite || card.cite;
    }
    const fidelity = {
      ok: !v2.reconstruct.fallback,
      matchRate: 1.0,
      structural: true,
      fallback: v2.reconstruct.fallback || false,
    };
    const cut = { content: '', model: v2.model };
    const finalCard = { ...card, cite: card.cite || cite };
    let saved = null;
    try {
      const r = await saveCutCardForUser(req.user?.id, {
        ...finalCard,
        url: result.article.url,
        source: result.article.source,
        title: result.article.title,
        author: result.article.author,
        date: result.article.date,
      });
      if (r) {
        saved = { id: r.card.id, duplicate: r.duplicate, typeLabel: r.card.typeLabel, topicLabel: r.card.topicLabel, argumentTypes: r.card.argumentTypes, argumentTags: r.card.argumentTags };
        if (!finalCard.id) finalCard.id = r.card.id;
      }
    } catch {}
    send('card', { card: finalCard, fidelity, saved, model: cut.model });
    if (saved) send('saved', saved);
    send('done', { ok: true });
  } catch (err) {
    send('error', { error: err.message });
  } finally {
    clearInterval(heartbeat);
    clearTimeout(wallClock);
    finish();
  }
});

router.post('/research-source', async (req, res) => {
  const { query = '', url = '', manualText = '' } = req.body || {};
  if (!String(query).trim() && !String(url).trim() && !String(manualText).trim()) {
    return res.status(400).json({ error: 'A query, URL, or manual text is required.' });
  }

  try {
    let result;
    try {
      result = await findBestResearchSource({
        query: String(query || ''),
        url: String(url || ''),
        manualText: String(manualText || ''),
      });
    } catch (error) {
      const fallbackContext = await buildChatContext(String(query || ''), {}, 1);
      const fallbackCard = fallbackContext.cards[0];
      if (!fallbackCard) throw error;

      result = {
        mode: 'library-fallback',
        article: {
          title: fallbackCard.tag || 'Local card source',
          author: '',
          date: '',
          source: fallbackCard.shortCite || fallbackCard.cite || 'Local library',
          url: '',
          bodyText: fallbackCard.body_plain || fallbackCard.body_markdown || '',
          isPdf: false,
        },
        excerpt: fallbackCard.body_plain || fallbackCard.body_markdown || '',
        candidates: [],
      };
    }

    let cite = '';
    let citeData = null;
    try {
      citeData = await buildCite({
        ...result.article,
        doi: result.article.doi || '',
      }, { inferQuals: true });
      cite = citeData.citeString;
    } catch {
      cite = `[No Author] [${result.article.title || result.article.source || 'Source'}${result.article.url ? `; ${result.article.url}` : ''}]`;
    }

    return res.json({
      mode: result.mode,
      article: result.article,
      paragraphs: result.article.paragraphs || [],
      excerpt: result.excerpt,
      window: result.window || null,
      windowReason: result.windowReason || '',
      cite,
      citeMeta: citeData ? {
        hasAuthor: citeData.hasAuthor,
        hasYear: citeData.hasYear,
        missing: citeData.missing,
      } : null,
      candidates: result.candidates,
      ranking: result.ranking || null,
      lowConfidence: Boolean(result.lowConfidence),
    });
  } catch (error) {
    return res.status(422).json({ error: error.message });
  }
});

router.post('/research', async (req, res) => {
  const { argument = '', bodyText = '' } = req.body;

  if (!bodyText || bodyText.trim().length < 50) {
    return res.status(400).json({ error: 'bodyText is required.' });
  }

  const truncated = smartTruncate(bodyText, 3000);
  const prompt = `You are an LD debate research assistant. The debater's argument intent is: "${argument || 'general research'}".

From the article text below, extract:
1. "summary": 2-sentence summary of the article's main argument
2. "keyWarrants": Array of 5-8 specific, quotable sentences with the strongest empirical claims, statistics, or causal mechanisms
3. "suggestedBlock": A sub-point label for this card
4. "suggestedTag": A punchy 1-sentence strategic claim for the Tag

Output valid JSON only: { "summary":"...", "keyWarrants":["..."], "suggestedBlock":"...", "suggestedTag":"..." }

ARTICLE:
---
${truncated}
---`;

  try {
    const result = await complete({
      messages: [
        { role: 'system', content: 'You are a concise LD debate research assistant. Output valid JSON only, no prose.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      maxTokens: 700,
    });

    let parsed;
    try {
      parsed = parseJSON(result.content);
    } catch {
      return res.status(502).json({ error: 'Could not parse research JSON.', raw: result.content.slice(0, 300) });
    }

    return res.json({ ...parsed, stats: result.stats, model: result.model });
  } catch (err) {
    return res.status(502).json({ error: err.message, modelsTriied: MODEL_CHAIN });
  }
});

// Returns the persisted calibration summary (aggregate stats only — no
// individual card content). Used to inspect what the analyzer learned
// from the library so we can bake high-value findings into the prompt.
router.get('/cutter-calibration', (_req, res) => {
  const cal = getCalibration();
  if (!cal) return res.status(404).json({ error: 'no_calibration_yet' });
  res.json(cal);
});

// In-memory cache for tag suggestions: key = sha256 of body+title, value
// = { tags, expiresAt }. 1-hour TTL. Cheap memo so reloading the cut UI
// doesn't re-charge per click.
const SUGGEST_CACHE = new Map();
const SUGGEST_TTL_MS = 60 * 60 * 1000;
const SUGGEST_MAX_ENTRIES = 200;

function suggestCacheKey({ bodyText, title }) {
  const h = require('crypto').createHash('sha256');
  h.update(String(bodyText || '').slice(0, 12000));
  h.update('|');
  h.update(String(title || ''));
  return h.digest('hex');
}

function suggestCacheGet(k) {
  const e = SUGGEST_CACHE.get(k);
  if (!e) return null;
  if (e.expiresAt < Date.now()) { SUGGEST_CACHE.delete(k); return null; }
  return e.tags;
}

function suggestCacheSet(k, tags) {
  if (SUGGEST_CACHE.size >= SUGGEST_MAX_ENTRIES) {
    const oldest = SUGGEST_CACHE.keys().next().value;
    if (oldest) SUGGEST_CACHE.delete(oldest);
  }
  SUGGEST_CACHE.set(k, { tags, expiresAt: Date.now() + SUGGEST_TTL_MS });
}

const {
  buildTagSuggesterSystemPrompt,
  buildTagSuggesterUserPrompt,
} = require('../prompts/tagSuggester');

// POST /api/ai/suggest-tags — returns 3 candidate tags for a source.
//
// Body shape (any one of):
//   { url: string, argument?: string }   — scrape URL via existing pipeline
//   { fileToken: string }                — use cached uploaded file
//   { bodyText: string, title?: string } — direct body text
//
// Response: { tags: [string, string, string], cached: boolean }
router.post('/suggest-tags', requireUser, async (req, res) => {
  try {
    const { url = '', fileToken = '', bodyText = '', title = '' } = req.body || {};

    // Resolve body text from one of the three input modes.
    let resolvedBody = '';
    let resolvedTitle = title;
    let resolvedMeta = {};

    if (bodyText && bodyText.length >= 200) {
      resolvedBody = bodyText;
    } else if (fileToken) {
      const cached = fileCache.get(fileToken);
      if (!cached) return res.status(400).json({ error: 'file_token_expired' });
      resolvedBody = cached.bodyText;
      resolvedTitle = resolvedTitle || cached.title || '';
    } else if (url) {
      try {
        const result = await findBestResearchSource({ query: '', url, onPhase: () => {} });
        resolvedBody = result?.article?.bodyText || '';
        resolvedTitle = resolvedTitle || result?.article?.title || '';
        resolvedMeta = {
          author: result?.article?.author || '',
          date:   result?.article?.date   || '',
          source: result?.article?.source || '',
        };
      } catch (err) {
        return res.status(400).json({ error: `Could not fetch source: ${err.message}` });
      }
    } else {
      return res.status(400).json({ error: 'url, fileToken, or bodyText required' });
    }

    if (!resolvedBody || resolvedBody.length < 200) {
      return res.status(400).json({ error: 'source body too short for tag suggestion' });
    }

    // Cache hit?
    const cacheKey = suggestCacheKey({ bodyText: resolvedBody, title: resolvedTitle });
    const cached = suggestCacheGet(cacheKey);
    if (cached) return res.json({ tags: cached, cached: true });

    // LLM call.
    const result = await llmCompleteJSON({
      messages: [
        { role: 'system', content: buildTagSuggesterSystemPrompt() },
        { role: 'user',   content: buildTagSuggesterUserPrompt({
            bodyText: resolvedBody,
            meta: { ...resolvedMeta, title: resolvedTitle },
          }) },
      ],
      schema: null,
      temperature: 0.4,   // a bit of variety across the 3 angles
      maxTokens: 500,
      forceModel: process.env.TAG_SUGGEST_MODEL || 'claude-haiku-4-5',
      fallbackModel: null,
      cacheSystem: true,
    });

    const tags = Array.isArray(result?.json?.tags) ? result.json.tags : [];
    // Normalize Unicode em dashes (— or –) to --- per Verbatim convention.
    const normalizeDashes = (s) => String(s || '').replace(/[—–]/g, '---');
    const clean = tags
      .map(t => normalizeDashes(String(t || '').trim()))
      .filter(t => t.length >= 5 && t.length <= 200)
      .slice(0, 3);

    if (!clean.length) return res.status(502).json({ error: 'no_tags_returned' });

    suggestCacheSet(cacheKey, clean);
    res.json({ tags: clean, cached: false });
  } catch (err) {
    console.warn('[suggest-tags] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/tokens', (req, res) => res.json(getTokenStats()));

router.get('/health', (req, res) => res.json({
  status: 'ok',
  version: '3.0.0',
  models: MODEL_CHAIN,
  time: new Date().toISOString(),
}));

router.get('/verify-url', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!url) return res.status(400).json({ ok: false, error: 'url required' });
  try {
    const r = await Promise.race([
      reachable(url),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);
    res.json({ ok: !!r?.ok, finalUrl: r?.url || url, archived: !!r?.archived });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
