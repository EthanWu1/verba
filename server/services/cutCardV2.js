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
const {
  reconstructCard, CARD_PICKS_JSON_SCHEMA,
  extractReadAloudChain, chainArgumentOverlap,
} = require('./cardReconstructor');
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

  // Stage 3 — single LLM call. Two-pass with chain validation:
  //  - Primary call (Haiku) emits picks JSON including the model's stated
  //    `argument`.
  //  - Server extracts the highlight chain from picks and compares to
  //    the `argument`. If overlap is too low (chain doesn't deliver the
  //    composed argument), retry on Sonnet with explicit critique.
  //  - cache_control: ephemeral so prompt caching activates on the long
  //    system prompt.
  const t0 = Date.now();
  let llmResult = await llm.completeJSON({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    schema: null,
    temperature: 0.1,
    maxTokens: 4000,
    forceModel: primaryModel,
    fallbackModel,
    cacheSystem: true,
  });

  // Stage 3b — chain validation. Compute the actual read-aloud chain
  // and check overlap with the model's stated argument. If the model
  // wrote a real argument but the highlights don't deliver it, this
  // catches it. Min overlap 0.45 = at least 45% of the argument's
  // content words must appear in the highlight chain.
  const CHAIN_OVERLAP_MIN = 0.45;
  const initialChain = extractReadAloudChain(llmResult.json, candidates);
  const initialArgument = String(llmResult.json?.argument || '').trim();
  const initialOverlap = chainArgumentOverlap(initialArgument, initialChain);
  let chainRetried = false;

  if (initialArgument && initialOverlap < CHAIN_OVERLAP_MIN && fallbackModel && fallbackModel !== primaryModel) {
    chainRetried = true;
    console.warn(
      `[cutCardV2] chain-argument overlap ${initialOverlap.toFixed(2)} < ${CHAIN_OVERLAP_MIN}, ` +
      `retrying on ${fallbackModel}\n` +
      `  argument: "${initialArgument.slice(0, 200)}"\n` +
      `  chain:    "${initialChain.slice(0, 200)}"`
    );

    const critique = `Your previous attempt produced an argument that the highlights don't deliver.

YOUR ARGUMENT: "${initialArgument}"
ACTUAL HIGHLIGHT CHAIN (read in document order): "${initialChain}"

The highlight chain MUST read as the argument. Re-emit picks so that:
  - Reading every highlighted phrase in order produces a sentence very close to your argument.
  - Each major content word in the argument has a corresponding highlight.
  - Connectors ("and", "to", "would") are 1-word highlights between content highlights.

Compose the argument FIRST. Then mark highlights that match it.`;

    try {
      const retry = await llm.completeJSON({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
          { role: 'user',   content: critique },
        ],
        schema: null,
        temperature: 0.1,
        maxTokens: 4000,
        forceModel: fallbackModel,
        fallbackModel: null,
        cacheSystem: true,
      });
      const retryChain = extractReadAloudChain(retry.json, candidates);
      const retryArg = String(retry.json?.argument || '').trim();
      const retryOverlap = chainArgumentOverlap(retryArg, retryChain);
      console.log(`[cutCardV2] chain-retry overlap: ${retryOverlap.toFixed(2)} (was ${initialOverlap.toFixed(2)})`);
      if (retryOverlap > initialOverlap) {
        llmResult = retry;
      }
    } catch (e) {
      console.warn(`[cutCardV2] chain-retry failed:`, e.message);
    }
  }
  const elapsed = Date.now() - t0;

  // Diagnostic: log what the model actually emitted. Compact summary to
  // avoid log spam but enough info to debug "nothing got highlighted"
  // failures from production logs alone.
  try {
    const j = llmResult.json || {};
    const picks = Array.isArray(j.picks) ? j.picks : [];
    const summary = picks.map(p => {
      const u = (p.u || []).length;
      const h = (p.h || []).length;
      const b = (p.b || []).length;
      // Show the max range value so we can tell if model used word vs char offsets
      const maxOffset = [...(p.u || []), ...(p.h || []), ...(p.b || [])]
        .flat().reduce((mx, n) => Math.max(mx, Number(n) || 0), 0);
      return `p${p.p}:u${u}/h${h}/b${b}(max=${maxOffset})`;
    }).join(' ');
    console.log(`[cutCardV2] llm emitted: tag="${(j.tag || '').slice(0, 40)}..." picks=${picks.length} ${summary}`);
  } catch {}

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

  // Final chain extraction for the response (post-reconstruction).
  const finalChain = extractReadAloudChain(llmResult.json, candidates);
  const finalArgument = String(llmResult.json?.argument || '').trim();
  const finalOverlap = chainArgumentOverlap(finalArgument, finalChain);

  const card = {
    tag: rebuilt.tag,
    cite: finalCite,
    shortCite,
    body_markdown: rebuilt.body_markdown,
    argument: finalArgument,           // model's composed speech (for transparency)
    readAloudChain: finalChain,        // what the highlights actually say in order
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

  // One-line success log — visible at-a-glance in PM2/journalctl so you can
  // monitor model usage, cache hit rate, and pipeline health in production.
  const u = llmResult.usage || {};
  const cacheRead = u.prompt_tokens_details?.cached_tokens || 0;
  const cacheWrite = u.prompt_tokens_details?.cache_write_tokens || 0;
  const cacheHitRate = u.prompt_tokens
    ? Math.round((cacheRead / u.prompt_tokens) * 100)
    : 0;
  // Compute mark visibility — if the user sees no marks, this will be 0.
  const marksRendered = rebuilt.body_markdown
    ? (rebuilt.body_markdown.match(/<u>|==/g) || []).length
    : 0;
  const highlightPct = rebuilt.stats.totalChars
    ? Math.round((rebuilt.stats.highlightChars / rebuilt.stats.totalChars) * 100)
    : 0;

  console.log(
    `[cutCardV2] ok in ${elapsed}ms model=${llmResult.model} ` +
    `paragraphs=${rebuilt.stats.paragraphs} ` +
    `marks=${marksRendered} highlight=${highlightPct}% ` +
    `chain-overlap=${(finalOverlap * 100).toFixed(0)}% ` +
    `prompt=${u.prompt_tokens || '?'}tok completion=${u.completion_tokens || '?'}tok ` +
    `cache=${cacheHitRate}%(read=${cacheRead}/write=${cacheWrite}) ` +
    `cost=$${(u.cost || 0).toFixed(5)}` +
    (chainRetried ? ' CHAIN_RETRIED' : '') +
    (rebuilt.fallback ? ' FALLBACK' : '') +
    (llmResult.fallback ? ' SCHEMA_FALLBACK' : '') +
    (marksRendered === 0 ? ' ⚠ NO_MARKS' : '')
  );

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
