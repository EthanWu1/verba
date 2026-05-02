'use strict';

/**
 * cutCardV2.js — full pipeline orchestrator for the cost-optimized cutter.
 *
 *   article body  ──▶  BM25 paragraph filter  ──▶  selection prompt
 *                                                    │
 *                                                    ▼
 *   final card   ◀── deterministic reconstruct ◀── one LLM call
 *                                                  (Haiku, prompt-cached,
 *                                                   json_schema strict)
 *
 * 100% verbatim and 100% paragraph integrity are *structural* — the LLM
 * never writes source words; the server pulls candidate paragraphs and
 * inserts marks at word offsets. There is no fidelity retry loop because
 * fidelity cannot be violated by construction.
 */

const crypto = require('crypto');
const { selectCandidates } = require('./argumentRelevance');
const { reconstructCard, CARD_PICKS_JSON_SCHEMA } = require('./cardReconstructor');
// Live module reference — accessing llm.completeJSON inside the function (not
// destructuring at load time) lets tests stub the LLM call by mutating the
// llm module's exports.
const llm = require('./llm');
const {
  buildSelectionSystemPrompt,
  buildSelectionUserPrompt,
} = require('../prompts/cardCutter');
const { buildCalibrationSnippet, getCalibration } = require('./cutterCalibration');

// ── Request-level dedupe cache (Phase 6) ────────────────────────────
// Hits return the previously-built card immediately, no LLM call.
// 1-hour TTL; capped at 200 entries (LRU-ish via Map insertion order).
const CACHE = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

function canonicalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function cacheKey({ bodyText, argument, density, length, model }) {
  const h = crypto.createHash('sha256');
  h.update(canonicalize(bodyText));
  h.update('|');
  h.update(canonicalize(argument));
  h.update('|');
  h.update(String(density));
  h.update('|');
  h.update(String(length));
  h.update('|');
  h.update(String(model));
  return h.digest('hex');
}

function cacheGet(key) {
  const e = CACHE.get(key);
  if (!e) return null;
  if (e.expiresAt < Date.now()) { CACHE.delete(key); return null; }
  // Refresh LRU order.
  CACHE.delete(key);
  CACHE.set(key, e);
  return e.payload;
}

function cacheSet(key, payload) {
  if (CACHE.size >= CACHE_MAX_ENTRIES) {
    const oldest = CACHE.keys().next().value;
    if (oldest) CACHE.delete(oldest);
  }
  CACHE.set(key, { payload, expiresAt: Date.now() + CACHE_TTL_MS });
}

function clearCache() { CACHE.clear(); }

// ── Pipeline ────────────────────────────────────────────────────────

const DEFAULT_PRIMARY  = process.env.CARD_CUT_MODEL          || 'anthropic/claude-haiku-4.5';
const DEFAULT_FALLBACK = process.env.CARD_CUT_FALLBACK_MODEL || 'anthropic/claude-sonnet-4.6';

/**
 * Cut a card from a single source text using the v2 pipeline.
 *
 * @param {object} args
 * @param {string} args.argument
 * @param {string} args.bodyText
 * @param {object} [args.meta]              — { author, title, source, date, url }
 * @param {string} [args.cite]              — preferred cite string from autocite
 * @param {string} [args.density='heavy']
 * @param {string} [args.length='long']
 * @param {number} [args.k=15]              — paragraph candidates to send the model
 * @param {boolean}[args.useCache=true]
 * @param {string} [args.primaryModel]
 * @param {string} [args.fallbackModel]
 *
 * @returns {Promise<object>} {
 *   card:       { tag, cite, body_markdown, shortCite },
 *   candidates: [{ index, originalIndex, text }],
 *   reconstruct:{ paragraphs, totalWords, underlineWords, highlightWords, dropped, fallback? },
 *   model:      string,
 *   usage:      object,
 *   stats:      object,
 *   cached:     boolean,
 *   schemaFallback: boolean,
 * }
 */
async function cutCardV2({
  argument = '',
  bodyText = '',
  meta = {},
  cite = '',
  density = 'heavy',
  length = 'long',
  k = 15,
  useCache = true,
  primaryModel = DEFAULT_PRIMARY,
  fallbackModel = DEFAULT_FALLBACK,
} = {}) {
  if (!bodyText || bodyText.trim().length < 50) {
    throw new Error('bodyText must be at least 50 characters.');
  }

  // Stage 0 — cache hit?
  const key = cacheKey({ bodyText, argument, density, length, model: primaryModel });
  if (useCache) {
    const hit = cacheGet(key);
    if (hit) return { ...hit, cached: true };
  }

  // Stage 1 — paragraph filter (deterministic, no LLM cost).
  const { candidates } = selectCandidates({
    bodyText, argument, k, neighbours: 1, stripBoilerplate: true,
  });

  if (!candidates.length) {
    throw new Error('No usable paragraphs in source text.');
  }

  // Stage 2 — build prompts.
  const calibration = buildCalibrationSnippet(getCalibration());
  const systemPrompt = buildSelectionSystemPrompt({ density, length, calibration });
  const userPrompt = buildSelectionUserPrompt({ argument, candidates, meta, cite, density, length });

  // Stage 3 — single LLM call, strict json_schema, prompt-cached system.
  const t0 = Date.now();
  let llmResult;
  try {
    llmResult = await llm.completeJSON({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      schema: CARD_PICKS_JSON_SCHEMA,
      temperature: 0.1,
      maxTokens: 1500,
      forceModel: primaryModel,
      fallbackModel,
      cacheSystem: true,
    });
  } catch (err) {
    // Even json_schema strict can fail if the provider rejects schema mode.
    // Try one degraded call without schema; reconstructor's defensive
    // validation will drop any garbage spans.
    console.warn('[cutCardV2] schema mode failed, retrying without schema:', err.message);
    llmResult = await llm.completeJSON({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      schema: null,
      temperature: 0.1,
      maxTokens: 1500,
      forceModel: fallbackModel,
      cacheSystem: true,
    });
  }
  const elapsed = Date.now() - t0;

  // Stage 4 — deterministic reconstruction.
  const rebuilt = reconstructCard({
    picksJson: llmResult.json,
    candidates,
    density,
  });

  // Server-built cite always wins when present (matches legacy behaviour).
  let finalCite = rebuilt.cite || '';
  if (cite && (cite.length >= finalCite.length || cite.includes('['))) {
    finalCite = cite;
  }

  // Derive shortCite from cite for the legacy response shape.
  let shortCite = '';
  const m = (finalCite || '').match(/^([^\[]+?)\s*\[/);
  shortCite = m ? m[1].trim() : (finalCite || '').slice(0, 40).trim();

  const card = {
    tag: rebuilt.tag,
    cite: finalCite,
    shortCite,
    body_markdown: rebuilt.body_markdown,
  };

  const payload = {
    card,
    candidates,
    reconstruct: { ...rebuilt.stats, fallback: rebuilt.fallback || false },
    model: llmResult.model,
    usage: llmResult.usage,
    stats: llmResult.stats,
    schemaFallback: llmResult.fallback || false,
    elapsedMs: elapsed,
    cached: false,
  };

  if (useCache) cacheSet(key, payload);
  return payload;
}

module.exports = {
  cutCardV2,
  cacheKey,
  clearCache,
  // exposed for tests:
  CACHE,
};
