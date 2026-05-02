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

const { complete, completeStream, parseJSON, smartTruncate, getTokenStats, MODEL_CHAIN } = require('../services/llm');
const { SYSTEM_PROMPT, buildSystemPrompt, buildCutPrompt, buildEditPrompt, LENGTH_PRESETS, DENSITY_PRESETS } = require('../prompts/cardCutter');

const LENGTH_BUDGETS = {
  short:  { input: 6000,  output: 2600 },
  medium: { input: 9000,  output: 4500 },
  long:   { input: 16000, output: 8000 },
};
// Defaults: 'standard' density (45–65% underline) is the preferred read-aloud
// weight; 'medium' length keeps cards focused on the operative warrant rather
// than copying the whole article.
function normalizeDensity(v) { return DENSITY_PRESETS[v] ? v : 'standard'; }
function normalizeLength(v)  { return LENGTH_PRESETS[v]  ? v : 'medium'; }
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

// Card cutting: explicit claude-haiku-4.5 (verified OpenRouter ID). Falls
// back to Sonnet-4.6 on hedge / parse failure.
const CARD_CUT_MODEL          = process.env.CARD_CUT_MODEL          || 'anthropic/claude-haiku-4.5';
const CARD_CUT_FALLBACK_MODEL = process.env.CARD_CUT_FALLBACK_MODEL || 'anthropic/claude-sonnet-4.6';

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
  const budget = LENGTH_BUDGETS[length];

  if (!bodyText || bodyText.trim().length < 50) {
    return res.status(400).json({ error: 'bodyText must be at least 50 characters.' });
  }

  const truncated = smartTruncate(bodyText, budget.input);
  const systemPrompt = buildSystemPrompt({ density, length });
  const userMsg = buildCutPrompt({ argument, bodyText: truncated, meta, cite, density, length });

  try {
    const result = await complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.15,
      maxTokens: budget.output,
      forceModel: CARD_CUT_MODEL,
    });

    let card;
    let rawContent = result.content;
    let parsedOk = false;
    try { card = parseJSON(rawContent); parsedOk = true; } catch {}

    // Retry 1: same model with explicit "JSON only" nudge if parse failed.
    if (!parsedOk) {
      try {
        const retry = await complete({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg },
            { role: 'user', content: 'IMPORTANT: your previous reply was NOT valid JSON. Reply NOW with the JSON object only — must start with `{`, end with `}`, no markdown fence, no commentary, no prose preamble. Re-cut the same source text from scratch.' },
          ],
          temperature: 0.05,
          maxTokens: budget.output,
          forceModel: CARD_CUT_MODEL,
        });
        rawContent = retry.content;
        try { card = parseJSON(rawContent); parsedOk = true; } catch {}
      } catch {}
    }

    // Retry 2: escalate to Sonnet if Haiku still produced non-JSON, hedged,
    // or returned an empty body. Same prompt — usually clean output here.
    if (!parsedOk || isLikelyHedge(rawContent) || !card?.body_markdown) {
      console.warn(`[cut-card] escalating to ${CARD_CUT_FALLBACK_MODEL} (hedge/parse failure on ${CARD_CUT_MODEL})`);
      try {
        const escalated = await complete({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg },
          ],
          temperature: 0.1,
          maxTokens: budget.output,
          forceModel: CARD_CUT_FALLBACK_MODEL,
        });
        rawContent = escalated.content;
        try { card = parseJSON(rawContent); parsedOk = true; } catch {}
      } catch (e) {
        console.warn(`[cut-card] fallback model failed:`, e.message);
      }
    }

    if (!parsedOk) {
      return res.status(502).json({
        error: 'AI returned malformed JSON twice in a row. Try again — sometimes the model needs a third attempt, or use the paste fallback.',
        raw: rawContent.slice(0, 400),
      });
    }

    if (!card.body_markdown && !card.tag) {
      return res.status(502).json({
        error: 'AI output is missing required fields (tag/body_markdown).',
        raw: rawContent.slice(0, 300),
      });
    }

    // Cite policy: server's buildCite output is the source of truth. The LLM
    // routinely truncates or fabricates cite fields, so we override with the
    // server-built cite whenever it exists and is longer/more-complete.
    // Reasoning: buildCite is deterministic and uses real meta (title, author,
    // date, source, URL) — every available field gets included.
    if (cite && (cite.length >= (card.cite || '').length || cite.includes('['))) {
      card.cite = cite;
    }
    // Always populate shortCite from the cite (the "Last 'YY" prefix before "[").
    if (!card.shortCite) {
      const m = (card.cite || '').match(/^([^\[]+?)\s*\[/);
      card.shortCite = m ? m[1].trim() : (card.cite || '').slice(0, 40).trim();
    }

    const cutCheck = validateCut(card.body_markdown || '', truncated, { density });
    if (!cutCheck.ok) {
      const retryResult = await complete({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: buildCutPrompt({ argument, bodyText: truncated, meta, cite, density, length, critique: cutCheck.critique }) },
        ],
        temperature: 0.1,
        maxTokens: budget.output,
        forceModel: CARD_CUT_MODEL,
      });
      try { card = parseJSON(retryResult.content); }
      catch {}
    }

    // Strict fidelity gate: every 5-word window in the output must appear in
    // SOURCE TEXT verbatim. Retry up to 2 times with escalating critique. If
    // we never reach 100%, fail the request rather than save a faulty card.
    let fidelity = verifyBodyFidelity(card.body_markdown, truncated);
    let attempts = 0;
    const MAX_FID_RETRIES = 2;
    while (!fidelity.ok && attempts < MAX_FID_RETRIES) {
      attempts++;
      // Escalate to the premium model on the LAST attempt — gives Haiku a
      // chance first (cheap), then Sonnet to clean up if it can't.
      const retryModel = attempts >= MAX_FID_RETRIES ? CARD_CUT_FALLBACK_MODEL : CARD_CUT_MODEL;
      console.warn(`[cut-card] fidelity ${(fidelity.matchRate || 0).toFixed(3)} — strict retry ${attempts}/${MAX_FID_RETRIES} on ${retryModel}`);
      const fidCritique =
        `FIDELITY FAIL — your previous output altered, skipped, or re-ordered source words. ` +
        `Examples missing from SOURCE: ${(fidelity.missing || []).slice(0,5).map(m => '"' + m + '"').join(', ') || '(none surfaced)'}. ` +
        `STRICT RULES: every word inside the cut (including inside <u>…</u>, **…**, and ==…==) must appear in SOURCE in the EXACT same order and spelling. Drop any paragraph you cannot copy 100% verbatim. No paraphrasing, no skipping, no inserted connectives, no synonym substitution. If you can't find a 100%-verbatim qualifying paragraph, return a SHORTER card from fewer paragraphs.`;
      try {
        const retry = await complete({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: buildCutPrompt({ argument, bodyText: truncated, meta, cite, density, length, critique: fidCritique }) },
          ],
          temperature: 0,
          maxTokens: budget.output,
          forceModel: retryModel,
        });
        try {
          const retryCard = parseJSON(retry.content);
          if (retryCard && retryCard.body_markdown) {
            const retryFid = verifyBodyFidelity(retryCard.body_markdown, truncated);
            if ((retryFid.matchRate || 0) >= (fidelity.matchRate || 0)) {
              card = retryCard;
              fidelity = retryFid;
              // Same cite override as above — trust server's buildCite output.
              if (cite && (cite.length >= (card.cite || '').length || cite.includes('['))) {
                card.cite = cite;
              }
              if (!card.shortCite) {
                const m = (card.cite || '').match(/^([^\[]+?)\s*\[/);
                card.shortCite = m ? m[1].trim() : (card.cite || '').slice(0, 40).trim();
              }
            }
          }
        } catch { /* keep best so far */ }
      } catch { /* keep best so far */ }
    }
    if (!fidelity.ok) {
      // Strict per-paragraph repair: a paragraph survives ONLY if its stripped
      // plain text is a contiguous substring of source (after normalizing
      // smart quotes, em-dashes, NBSP, and whitespace). Anything else is
      // dropped. Result: every surviving word is guaranteed verbatim.
      const normalize = (s) => String(s || '')
        .replace(/[‘’‚‛′]/g, "'")
        .replace(/[“”„‟″]/g, '"')
        .replace(/[–—―]/g, '-')
        .replace(/[ ]/g, ' ')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
      const sourceNorm = normalize(truncated);
      const cardParas = String(card.body_markdown || '').split(/\n{2,}/);
      const goodParas = [];
      for (const p of cardParas) {
        const plain = normalize(stripFormatMarks(p));
        if (!plain) continue;
        // Substring check: the entire paragraph's plain text must appear
        // verbatim somewhere in source. No sampling, no exceptions.
        if (sourceNorm.includes(plain)) goodParas.push(p);
      }
      if (goodParas.length === 0) {
        return res.status(502).json({
          error: 'Could not produce a 100% verbatim card. The model altered every paragraph.',
          fidelity,
          hint: 'Try again or use the paste-fallback panel.',
        });
      }
      card.body_markdown = goodParas.join('\n\n');
      fidelity = verifyBodyFidelity(card.body_markdown, truncated);
      console.warn(`[cut-card] strict paragraph-repair kept ${goodParas.length}/${cardParas.length} paragraphs, fidelity now ${(fidelity.matchRate || 0).toFixed(3)}`);
    }

    let saved = null;
    try {
      const r = await saveCutCardForUser(req.user?.id, { ...card, ...meta, cite: card.cite || cite });
      if (r) saved = { id: r.card.id, duplicate: r.duplicate, typeLabel: r.card.typeLabel, topicLabel: r.card.topicLabel, argumentTypes: r.card.argumentTypes, argumentTags: r.card.argumentTags };
      if (r && !card.id) card.id = r.card.id;
    } catch {}

    return res.json({
      card,
      fidelity,
      saved,
      stats: result.stats,
      model: result.model,
    });
  } catch (err) {
    return res.status(502).json({
      error: err.message,
      hint: 'If the free model tier is full, the server will retry backup models automatically.',
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
  const systemPrompt = buildSystemPrompt({ density, length });

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
    const truncated = smartTruncate(cutBody, budget.input);
    const userMsg = buildCutPrompt({
      argument,
      bodyText: truncated,
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
    });
    let cut;
    try {
      cut = await Promise.race([
        completeStream({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg },
          ],
          temperature: 0.15,
          maxTokens: budget.output,
          forceModel: CARD_CUT_MODEL,
          onToken: (_delta, acc) => { send('card_delta', { acc }); },
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('LLM cut timeout 25s')), 25000)),
      ]);
    } catch (cutErr) {
      if (cutErr.message === 'LLM cut timeout 25s') {
        send('phase', { type: 'cut_retry', reason: 'llm-timeout' });
        const partialCard = { tag: result.article.title || 'Untitled', cite, body_markdown: result.excerpt || '' };
        send('card', { card: { ...partialCard, cite: partialCard.cite || cite }, fidelity: { ok: false }, model: CARD_CUT_MODEL });
        send('done', { ok: true });
        return;
      }
      throw cutErr;
    }
    let card;
    try { card = parseJSON(cut.content); }
    catch {
      card = { tag: result.article.title || 'Untitled', cite, body_markdown: cut.content || result.excerpt || '' };
    }
    const cutCheck = validateCut(card.body_markdown || '', truncated, { density });
    if (!cutCheck.ok) {
      send('phase', { type: 'cut_retry', reason: 'over-highlighted' });
      const retryMsg = buildCutPrompt({
        argument,
        bodyText: truncated,
        cite,
        density,
        length,
        critique: cutCheck.critique,
        meta: {
          url: result.article.url,
          source: result.article.source,
          title: result.article.title,
          author: result.article.author,
          date: result.article.date,
        },
      });
      try {
        // NO onToken on retry — first-pass card already rendered as ghost.
        // Streaming retry deltas overwrites the DOM and looks like "cuts, deletes, recuts".
        // Retry runs silently; only the final `card` event replaces the ghost.
        const cut2 = await Promise.race([
          completeStream({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: retryMsg },
            ],
            temperature: 0.1,
            maxTokens: budget.output,
            forceModel: CARD_CUT_MODEL,
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('LLM cut timeout 10s')), 10000)),
        ]);
        try { card = parseJSON(cut2.content); cut = cut2; }
        catch { /* keep first attempt */ }
      } catch (retryErr) {
        if (retryErr.message === 'LLM cut timeout 10s') {
          send('phase', { type: 'cut_retry', reason: 'llm-timeout' });
        }
        /* keep first attempt card */
      }
    }
    if (result.article.url && !validateCiteMatchesMeta(card.cite, { url: result.article.url })) {
      card.cite = cite || card.cite;
    }
    const fidelity = verifyBodyFidelity(card.body_markdown, truncated);
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
