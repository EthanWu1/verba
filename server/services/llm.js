/**
 * services/llm.js — v2.1
 * Fixes "No endpoints found" by:
 *  1. Trying a 4-model rotation chain
 *  2. Treating 400 "no endpoints found" as a soft failure → next model
 *  3. Adding detailed console diagnostics
 *  4. Stripping unsupported parameters per model
 */

'use strict';

const axios = require('axios');
require('dotenv').config();

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const DAILY_BUDGET   = parseInt(process.env.TOKEN_BUDGET_DAILY || '50000', 10);

// 4-model rotation chain — loaded from .env, with hardcoded fallbacks
const MODEL_CHAIN = [
  process.env.MODEL     || 'meta-llama/llama-3.3-70b-instruct:free',
  process.env.MODEL_2   || 'mistralai/mistral-7b-instruct:free',
  process.env.MODEL_3   || 'google/gemma-2-9b-it:free',
  process.env.MODEL_4   || 'openrouter/auto',
].filter((v, i, a) => a.indexOf(v) === i); // deduplicate

/* ── Token session ── */
const tokenSession = {
  promptTokens: 0, completionTokens: 0, totalTokens: 0,
  requestCount: 0, dailyUsed: 0, resetDate: new Date().toDateString(),
};

function checkDailyReset() {
  const today = new Date().toDateString();
  if (tokenSession.resetDate !== today) {
    tokenSession.dailyUsed = 0;
    tokenSession.resetDate = today;
    console.log('[LLM] Daily token counter reset.');
  }
}

function recordUsage(usage) {
  if (!usage) return;
  tokenSession.promptTokens     += usage.prompt_tokens     || 0;
  tokenSession.completionTokens += usage.completion_tokens || 0;
  tokenSession.totalTokens      += usage.total_tokens      || 0;
  tokenSession.dailyUsed        += usage.total_tokens      || 0;
  tokenSession.requestCount     += 1;
}

function getTokenStats() {
  checkDailyReset();
  return {
    ...tokenSession,
    modelChain:     MODEL_CHAIN,
    dailyBudget:    DAILY_BUDGET,
    dailyRemaining: Math.max(0, DAILY_BUDGET - tokenSession.dailyUsed),
    budgetExhausted: tokenSession.dailyUsed >= DAILY_BUDGET,
  };
}

function estimateTokens(text) { return Math.ceil((text || '').length / 4); }

function smartTruncate(text, targetTokens = 4500) {
  const est = estimateTokens(text);
  if (est <= targetTokens) return text;
  const keepChars = targetTokens * 4;
  const paragraphs = String(text).split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  // Greedy pack from the start at paragraph boundaries. Never split mid-paragraph.
  const kept = [];
  let used = 0;
  for (const p of paragraphs) {
    if (used + p.length + 2 > keepChars) break;
    kept.push(p);
    used += p.length + 2;
  }
  if (kept.length < 2 && paragraphs.length) {
    // Single giant paragraph: keep it whole up to a hard ceiling (never cut mid-sentence).
    const first = paragraphs[0];
    if (first.length <= keepChars * 1.2) return first;
    const hardCut = first.slice(0, keepChars);
    const lastStop = Math.max(hardCut.lastIndexOf('. '), hardCut.lastIndexOf('? '), hardCut.lastIndexOf('! '));
    return lastStop > keepChars * 0.5 ? hardCut.slice(0, lastStop + 1) : hardCut;
  }
  return kept.join('\n\n');
}

/**
 * isSoftFailure — returns true for errors where we should try the next model.
 * Covers: rate limits, no endpoints found, capacity errors, model-specific 4xx.
 */
function safeStringify(v) {
  // err.response.data can be a Stream (responseType:'stream') with circular
  // socket→parser→socket refs. Plain JSON.stringify throws "Converting
  // circular structure to JSON … TLSSocket". Strip cycles + non-serializables.
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && (typeof v.pipe === 'function' || typeof v.read === 'function')) return '';
  try {
    const seen = new WeakSet();
    return JSON.stringify(v, (_k, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[circular]';
        seen.add(val);
      }
      return val;
    });
  } catch { return ''; }
}
function isSoftFailure(err) {
  const status = err.response?.status;
  const msg    = safeStringify(err.response?.data).toLowerCase();

  if (status === 429 || status === 503) return true;
  if (status === 400 && (
    msg.includes('no endpoints') ||
    msg.includes('no available') ||
    msg.includes('model not found') ||
    msg.includes('provider') ||
    msg.includes('overloaded')
  )) return true;
  if (status === 404) return true; // model doesn't exist on this key
  return false;
}

// Decorate the messages array so the system message is sent as a content
// block with cache_control: ephemeral. OpenRouter forwards this to Anthropic
// providers and records a 90% input-token discount on cache hits.
//
// Anthropic requires the cached prefix to be ≥1024 tokens to be effective —
// our cardCutter system prompt is several thousand tokens, so caching kicks
// in immediately.
//
// Models that don't support cache_control simply ignore the field.
function applyPromptCache(messages) {
  return messages.map(m => {
    if (m.role !== 'system' || typeof m.content !== 'string') return m;
    return {
      role: 'system',
      content: [
        { type: 'text', text: m.content, cache_control: { type: 'ephemeral' } },
      ],
    };
  });
}

// Force Anthropic-direct routing for Anthropic models. OpenRouter routes
// Anthropic models through multiple providers (Anthropic API, AWS Bedrock,
// Google Vertex). Prompt caching only works on Anthropic-direct, and some
// providers don't support response_format: json_schema. Forcing the order
// ensures we get the cheapest, fastest, cache-enabled route.
function providerHintFor(modelId) {
  if (typeof modelId === 'string' && modelId.startsWith('anthropic/')) {
    return { order: ['Anthropic'], allow_fallbacks: true };
  }
  return null;
}

/**
 * Core completion — rotates through MODEL_CHAIN until one succeeds.
 *
 * @param {object}  args
 * @param {array}   args.messages
 * @param {number}  [args.temperature=0.3]
 * @param {number}  [args.maxTokens=2048]
 * @param {string}  [args.forceModel=null]    — bypass the chain, use this exact model.
 * @param {object}  [args.responseFormat]     — passed through (json_object | json_schema).
 * @param {boolean} [args.cacheSystem=false]  — wrap system msg in cache_control:ephemeral.
 * @param {object}  [args.provider]           — OpenRouter provider preference. Auto-set
 *                                               for Anthropic models (Anthropic-direct).
 */
async function complete({
  messages,
  temperature = 0.3,
  maxTokens = 2048,
  forceModel = null,
  responseFormat = null,
  cacheSystem = false,
  provider = null,
}) {
  checkDailyReset();

  if (tokenSession.dailyUsed >= DAILY_BUDGET) {
    throw new Error(`Daily token budget (${DAILY_BUDGET}) exhausted. Try again tomorrow.`);
  }

  const chain = forceModel ? [forceModel] : MODEL_CHAIN;
  const errors = [];
  const finalMessages = cacheSystem ? applyPromptCache(messages) : messages;

  for (const m of chain) {
    console.log(`[LLM] Trying model: ${m}`);
    try {
      const body = {
        model: m,
        messages: finalMessages,
        temperature,
        max_tokens: maxTokens,
      };
      if (responseFormat) body.response_format = responseFormat;
      // Provider preference: explicit > Anthropic auto-hint > none.
      const providerHint = provider || providerHintFor(m);
      if (providerHint) body.provider = providerHint;

      const resp = await axios.post(
        `${OPENROUTER_BASE}/chat/completions`,
        body,
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type':  'application/json',
            'HTTP-Referer':  'http://localhost:3000',
            'X-Title':       'Verbatim AI Card Cutter',
          },
          timeout: 120000,
        }
      );

      const data = resp.data;
      recordUsage(data.usage);

      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response from model');

      console.log(`[LLM] ✓ ${m} | Tokens: ${JSON.stringify(data.usage)}`);
      return { content, usage: data.usage, model: m, stats: getTokenStats() };

    } catch (err) {
      const status  = err.response?.status;
      const errData = err.response?.data;
      const errMsg  = errData?.error?.message || err.message;

      console.warn(`[LLM] ✗ ${m} (${status || 'TIMEOUT'}): ${errMsg}`);
      if (errData) console.warn('[LLM] Response body:', safeStringify(errData).slice(0, 300));

      errors.push(`${m}: ${errMsg}`);

      if (isSoftFailure(err)) {
        console.warn(`[LLM] Soft failure — rotating to next model...`);
        continue;
      }

      // Hard failure (auth, billing, etc.) — no point rotating
      if (status === 401 || status === 402) {
        throw new Error(`Auth/billing error (${status}): ${errMsg}. Check your OpenRouter key/credits.`);
      }

      // Unknown — still try next model rather than crash
      errors.push(`Unknown error, trying next...`);
      continue;
    }
  }

  throw new Error(
    `All models in rotation failed.\n${errors.slice(-4).join('\n')}\n` +
    `Check: 1) API key valid, 2) OpenRouter credits, 3) Model names at openrouter.ai/models`
  );
}

/**
 * Parse JSON from LLM output — handles markdown fences, trailing commas,
 * truncation (auto-closes unclosed brackets), and prose preambles.
 */
function parseJSON(text) {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/```\s*$/im, '')
    .trim();

  // 1. Direct parse
  try { return JSON.parse(cleaned); } catch {}

  // 2. Extract from first '{' to last '}'. Greedier than first-match regex.
  const firstBrace = cleaned.indexOf('{');
  const lastBrace  = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = cleaned.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(candidate); } catch {}
    // 2a. Fix trailing commas
    try { return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1')); } catch {}
  }

  // 3. Truncation rescue: take from first '{' to end of string and close
  //    open brackets/braces in REVERSE order of opening (stack-based).
  //    Recovers arrays/objects the model started but never closed
  //    (token-budget cutoff).
  if (firstBrace !== -1) {
    let body = cleaned.slice(firstBrace);
    let inString = false, escape = false;
    const stack = []; // chars '{' / '[' in opening order
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' || c === ']') stack.pop();
    }
    if (inString) body += '"';
    // Strip trailing comma after last value (if any) before closing.
    body = body.replace(/,\s*$/, '');
    // Close in reverse order, matching each opening to its closer.
    while (stack.length) {
      const open = stack.pop();
      body += (open === '{' ? '}' : ']');
    }
    try { return JSON.parse(body); } catch {}
    try { return JSON.parse(body.replace(/,\s*([}\]])/g, '$1')); } catch {}
  }

  throw new Error('Could not parse JSON from LLM. Raw output: ' + cleaned.slice(0, 300));
}

/**
 * Streaming completion — forwards each delta to onToken(chunk).
 * Falls back through MODEL_CHAIN on soft failures before first token.
 * Resolves to { content, usage, model, stats }.
 */
async function completeStream({ messages, temperature = 0.3, maxTokens = 2048, forceModel = null, onToken }) {
  checkDailyReset();
  if (tokenSession.dailyUsed >= DAILY_BUDGET) {
    throw new Error(`Daily token budget (${DAILY_BUDGET}) exhausted.`);
  }
  const chain = forceModel ? [forceModel] : MODEL_CHAIN;
  const errors = [];

  for (const m of chain) {
    console.log(`[LLM stream] Trying model: ${m}`);
    try {
      const resp = await axios.post(
        `${OPENROUTER_BASE}/chat/completions`,
        { model: m, messages, temperature, max_tokens: maxTokens, stream: true },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type':  'application/json',
            'HTTP-Referer':  'http://localhost:3000',
            'X-Title':       'Verbatim AI Card Cutter',
          },
          timeout: 120000,
          responseType: 'stream',
        }
      );

      let content = '';
      let usage = null;
      let buffer = '';
      const IDLE_MS = 10000;
      const WALL_MS = 30000;
      await new Promise((resolve, reject) => {
        let idle = setTimeout(() => {
          try { resp.data.destroy(); } catch {}
          reject(new Error(`stream idle > ${IDLE_MS}ms (no tokens)`));
        }, IDLE_MS);
        const wall = setTimeout(() => {
          try { resp.data.destroy(); } catch {}
          reject(new Error(`stream wall-clock > ${WALL_MS}ms`));
        }, WALL_MS);
        const bumpIdle = () => {
          clearTimeout(idle);
          idle = setTimeout(() => {
            try { resp.data.destroy(); } catch {}
            reject(new Error(`stream idle > ${IDLE_MS}ms (no tokens)`));
          }, IDLE_MS);
        };
        resp.data.on('data', (chunk) => {
          bumpIdle();
          buffer += chunk.toString('utf8');
          let lineEnd;
          while ((lineEnd = buffer.indexOf('\n')) !== -1) {
            const rawLine = buffer.slice(0, lineEnd).trim();
            buffer = buffer.slice(lineEnd + 1);
            if (!rawLine || !rawLine.startsWith('data:')) continue;
            const payload = rawLine.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const j = JSON.parse(payload);
              if (j.usage) usage = j.usage;
              const delta = j.choices?.[0]?.delta?.content;
              if (delta) {
                content += delta;
                try { onToken?.(delta, content); } catch {}
              }
            } catch {}
          }
        });
        resp.data.on('end', () => { clearTimeout(idle); clearTimeout(wall); resolve(); });
        resp.data.on('error', (err) => { clearTimeout(idle); clearTimeout(wall); reject(err); });
      });

      if (!content) throw new Error('Empty stream from model');
      recordUsage(usage);
      console.log(`[LLM stream] ✓ ${m} | Tokens: ${JSON.stringify(usage)}`);
      return { content, usage, model: m, stats: getTokenStats() };
    } catch (err) {
      const status = err.response?.status;
      const errMsg = err.response?.data?.error?.message || err.message;
      console.warn(`[LLM stream] ✗ ${m} (${status || 'ERR'}): ${errMsg}`);
      errors.push(`${m}: ${errMsg}`);
      if (isSoftFailure(err)) continue;
      if (status === 401 || status === 402) throw new Error(`Auth/billing error (${status}): ${errMsg}`);
    }
  }

  throw new Error(`All models failed on stream.\n${errors.slice(-4).join('\n')}`);
}

/**
 * completeJSON — strict JSON-schema completion with one structural fallback.
 *
 * Tries the requested model first with json_schema strict mode. If JSON
 * parse fails (rare in strict mode), tries once more on the fallback model
 * with the same prompt. Throws if both attempts fail to produce valid JSON.
 *
 * Returns the parsed object plus call stats.
 *
 * @param {object} args
 * @param {array}  args.messages
 * @param {object} args.schema             — { name, strict, schema } object (the json_schema payload).
 * @param {number} [args.temperature=0.1]
 * @param {number} [args.maxTokens=1500]
 * @param {string} [args.forceModel]
 * @param {string} [args.fallbackModel]
 * @param {boolean}[args.cacheSystem=true]
 */
async function completeJSON({
  messages,
  schema,
  temperature = 0.1,
  maxTokens = 1500,
  forceModel = null,
  fallbackModel = null,
  cacheSystem = true,
  provider = null,
  preferJsonObject = false,
}) {
  // json_object is broadly supported across providers; json_schema strict is
  // not (e.g., Haiku 4.5 via some OpenRouter backends returns 400 "Provider
  // returned error" when given json_schema). Default to json_object — the
  // reconstructor's defensive validation makes strict schema unnecessary.
  const responseFormat = (schema && !preferJsonObject)
    ? { type: 'json_schema', json_schema: schema }
    : { type: 'json_object' };

  const tryOnce = async (model) => {
    const result = await complete({
      messages,
      temperature,
      maxTokens,
      forceModel: model,
      responseFormat,
      cacheSystem,
      provider,
    });
    let parsed = null;
    let parseErr = null;
    try { parsed = parseJSON(result.content); }
    catch (e) { parseErr = e.message; }
    if (!parsed) {
      // Diagnostic: show the head AND tail of the raw output so we can see
      // both the start (look for prose preamble) and the end (look for
      // truncation / unclosed JSON).
      const raw = String(result.content || '');
      const head = raw.slice(0, 400);
      const tail = raw.length > 800 ? raw.slice(-400) : '';
      console.warn(`[LLM] completeJSON parse fail on ${model}: ${parseErr}`);
      console.warn(`  raw head: ${JSON.stringify(head)}`);
      if (tail) console.warn(`  raw tail: ${JSON.stringify(tail)}`);
      console.warn(`  raw length: ${raw.length} chars, completion_tokens: ${result.usage?.completion_tokens || '?'}`);
    }
    return { parsed, result };
  };

  const primary = await tryOnce(forceModel);
  if (primary.parsed) {
    return { json: primary.parsed, model: primary.result.model, usage: primary.result.usage, stats: primary.result.stats, fallback: false };
  }

  if (fallbackModel) {
    console.warn(`[LLM] completeJSON: primary returned non-parseable JSON, escalating to ${fallbackModel}`);
    const secondary = await tryOnce(fallbackModel);
    if (secondary.parsed) {
      return { json: secondary.parsed, model: secondary.result.model, usage: secondary.result.usage, stats: secondary.result.stats, fallback: true };
    }
  }

  throw new Error('completeJSON: model produced non-parseable JSON on primary' + (fallbackModel ? ' and fallback' : '') + '.');
}

module.exports = { complete, completeJSON, completeStream, parseJSON, smartTruncate, estimateTokens, getTokenStats, MODEL_CHAIN, applyPromptCache };
