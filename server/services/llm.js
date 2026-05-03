/**
 * services/llm.js — v3.0 (Anthropic-direct)
 *
 * Calls Anthropic's API directly via @anthropic-ai/sdk. No more OpenRouter
 * routing tax, free-tier rate limits, or "no endpoints found" rotations.
 *
 * Public surface kept identical to v2.x so call sites in routes/, services/,
 * and scripts/ require zero changes:
 *   - complete({ messages, temperature, maxTokens, forceModel, responseFormat,
 *                cacheSystem, fallbackModel })
 *   - completeJSON({ messages, schema, temperature, maxTokens, forceModel,
 *                    fallbackModel, cacheSystem, ... })
 *   - completeStream({ messages, temperature, maxTokens, forceModel, onToken })
 *   - parseJSON, smartTruncate, estimateTokens, getTokenStats, applyPromptCache
 *   - MODEL_CHAIN (kept as [primary, fallback] for backward compat)
 *
 * Model ID normalization: accepts both legacy OpenRouter style
 * ("anthropic/claude-haiku-4.5") and native Anthropic style
 * ("claude-haiku-4-5"). The wrapper strips the prefix and converts dots → dashes.
 *
 * The `provider` arg from old call sites is silently dropped (irrelevant
 * when calling Anthropic direct).
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const DAILY_BUDGET = parseInt(process.env.TOKEN_BUDGET_DAILY || '500000', 10);

/**
 * Normalize legacy model IDs to native Anthropic format.
 *   anthropic/claude-haiku-4.5  →  claude-haiku-4-5
 *   claude-haiku-4.5            →  claude-haiku-4-5
 *   claude-haiku-4-5            →  claude-haiku-4-5  (passthrough)
 * Non-Anthropic models (e.g. left-over llama / mistral / deepseek defaults
 * still in prod env) are coerced to claude-haiku-4-5 with a one-time warning.
 *
 * Declared BEFORE PRIMARY_MODEL/FALLBACK_MODEL because those consts call
 * normalizeModel() at module load. If env has a non-Claude default, we'd
 * hit a TDZ ReferenceError on _warnedNonAnthropic before this declaration.
 */
const _warnedNonAnthropic = new Set();
function normalizeModel(id) {
  if (!id) return 'claude-haiku-4-5';
  let m = String(id).trim();
  if (m.startsWith('anthropic/')) m = m.slice('anthropic/'.length);
  // Reject anything that's clearly not Anthropic.
  if (!m.startsWith('claude-')) {
    if (!_warnedNonAnthropic.has(m)) {
      _warnedNonAnthropic.add(m);
      console.warn(`[LLM] Ignoring non-Anthropic model "${id}" — using claude-haiku-4-5 instead. Update your .env.`);
    }
    return 'claude-haiku-4-5';
  }
  // Anthropic console accepts dotted versions, but the SDK is happiest with
  // dashed canonical IDs. Convert "claude-haiku-4.5" → "claude-haiku-4-5".
  m = m.replace(/(\d)\.(\d)/g, '$1-$2');
  return m;
}

// Two-model setup: fast/cheap default, smarter fallback for hard cases.
const PRIMARY_MODEL  = normalizeModel(process.env.MODEL          || 'claude-haiku-4-5');
const FALLBACK_MODEL = normalizeModel(process.env.MODEL_FALLBACK || 'claude-sonnet-4-6');

// Kept for backward compatibility with routes that import MODEL_CHAIN
// (e.g. /api/tokens diagnostic, error responses).
const MODEL_CHAIN = [PRIMARY_MODEL, FALLBACK_MODEL].filter((v, i, a) => a.indexOf(v) === i);

let _client = null;
function getClient() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set in .env');
  }
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

/* ── Token session ── */
const tokenSession = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  requestCount: 0,
  dailyUsed: 0,
  resetDate: new Date().toDateString(),
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
  // Anthropic SDK shape: { input_tokens, output_tokens,
  //   cache_creation_input_tokens, cache_read_input_tokens }
  const inTok    = usage.input_tokens     || 0;
  const outTok   = usage.output_tokens    || 0;
  const cacheR   = usage.cache_read_input_tokens     || 0;
  const cacheW   = usage.cache_creation_input_tokens || 0;
  tokenSession.promptTokens     += inTok + cacheR + cacheW;
  tokenSession.completionTokens += outTok;
  tokenSession.totalTokens      += inTok + outTok + cacheR + cacheW;
  tokenSession.dailyUsed        += inTok + outTok + cacheR + cacheW;
  tokenSession.cacheReadTokens  += cacheR;
  tokenSession.cacheWriteTokens += cacheW;
  tokenSession.requestCount     += 1;
}

function getTokenStats() {
  checkDailyReset();
  return {
    ...tokenSession,
    modelChain:      MODEL_CHAIN,
    dailyBudget:     DAILY_BUDGET,
    dailyRemaining:  Math.max(0, DAILY_BUDGET - tokenSession.dailyUsed),
    budgetExhausted: tokenSession.dailyUsed >= DAILY_BUDGET,
  };
}

function estimateTokens(text) { return Math.ceil((text || '').length / 4); }

function smartTruncate(text, targetTokens = 4500) {
  const est = estimateTokens(text);
  if (est <= targetTokens) return text;
  const keepChars = targetTokens * 4;
  const paragraphs = String(text).split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  const kept = [];
  let used = 0;
  for (const p of paragraphs) {
    if (used + p.length + 2 > keepChars) break;
    kept.push(p);
    used += p.length + 2;
  }
  if (kept.length < 2 && paragraphs.length) {
    const first = paragraphs[0];
    if (first.length <= keepChars * 1.2) return first;
    const hardCut = first.slice(0, keepChars);
    const lastStop = Math.max(hardCut.lastIndexOf('. '), hardCut.lastIndexOf('? '), hardCut.lastIndexOf('! '));
    return lastStop > keepChars * 0.5 ? hardCut.slice(0, lastStop + 1) : hardCut;
  }
  return kept.join('\n\n');
}

/**
 * Anthropic's Messages API takes `system` as a top-level field, not as a
 * role-based message. Convert OpenAI-style messages to Anthropic shape.
 *
 * If cacheSystem=true, wrap the system prompt in a content block with
 * cache_control: ephemeral. Anthropic requires the cached prefix to be
 * ≥1024 tokens to be effective — our cardCutter system prompt is several
 * thousand tokens, so caching kicks in immediately.
 */
function toAnthropicMessages(messages, cacheSystem) {
  const sysParts = [];
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') {
      // System content might already be an array (from applyPromptCache).
      if (Array.isArray(m.content)) {
        for (const c of m.content) sysParts.push(c);
      } else {
        sysParts.push({ type: 'text', text: String(m.content) });
      }
    } else if (m.role === 'user' || m.role === 'assistant') {
      out.push({ role: m.role, content: m.content });
    }
  }
  let system;
  if (sysParts.length === 0) {
    system = undefined;
  } else if (cacheSystem) {
    // Mark the LAST system block as cache breakpoint. Anthropic uses the
    // last cache_control marker in the prefix as the cache boundary.
    system = sysParts.map((p, i) => {
      const block = { type: 'text', text: p.text || '' };
      if (i === sysParts.length - 1) block.cache_control = { type: 'ephemeral' };
      return block;
    });
  } else if (sysParts.length === 1 && !sysParts[0].cache_control) {
    // Simple string form is fine when no caching.
    system = sysParts[0].text;
  } else {
    system = sysParts;
  }
  return { system, messages: out };
}

/**
 * Legacy helper kept for backward compat. Old callers used this to wrap
 * system messages in cache_control blocks before passing to complete().
 * In v3, complete() does this automatically when cacheSystem=true, so
 * applyPromptCache is now a passthrough — but we keep the export so any
 * external consumers don't break.
 */
function applyPromptCache(messages) { return messages; }

/**
 * isRetryable — true for transient errors where we should try the fallback model.
 */
function isRetryable(err) {
  const status = err?.status || err?.response?.status;
  if (status === 429 || status === 503 || status === 529) return true; // overloaded
  if (status === 500 || status === 502 || status === 504) return true;
  if (err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT') return true;
  return false;
}

/**
 * Apply json_object response_format → instruct the model to return JSON.
 * Anthropic doesn't have an OpenAI-style response_format flag; the
 * canonical pattern is a system instruction + (optionally) an assistant
 * pre-fill of "{". We append the instruction to the system prompt.
 */
function injectJsonInstruction(system, format) {
  if (!format) return system;
  const isJson = format.type === 'json_object' || format.type === 'json_schema';
  if (!isJson) return system;
  let extra = '\n\nRespond ONLY with valid JSON. No prose, no markdown fences, no comments.';
  if (format.type === 'json_schema' && format.json_schema?.schema) {
    extra += '\n\nThe JSON must conform to this schema:\n' + JSON.stringify(format.json_schema.schema);
  }
  if (typeof system === 'string') return system + extra;
  if (Array.isArray(system)) {
    const last = system[system.length - 1];
    if (last && typeof last.text === 'string') {
      return [
        ...system.slice(0, -1),
        { ...last, text: last.text + extra },
      ];
    }
    return [...system, { type: 'text', text: extra.trim() }];
  }
  return extra.trim();
}

/**
 * Core completion — tries primary, then fallback on transient failures.
 *
 * @param {object}  args
 * @param {array}   args.messages
 * @param {number}  [args.temperature=0.3]
 * @param {number}  [args.maxTokens=2048]
 * @param {string}  [args.forceModel]        — bypass primary, use this exact model.
 * @param {string}  [args.fallbackModel]     — override default fallback.
 * @param {object}  [args.responseFormat]    — { type: 'json_object' | 'json_schema', ... }
 * @param {boolean} [args.cacheSystem=false] — wrap system in cache_control: ephemeral.
 * @param {object}  [args.provider]          — IGNORED (legacy OpenRouter param).
 */
async function complete({
  messages,
  temperature = 0.3,
  maxTokens = 2048,
  forceModel = null,
  fallbackModel = null,
  responseFormat = null,
  cacheSystem = false,
  provider: _provider = null,  // eslint-disable-line no-unused-vars
}) {
  checkDailyReset();
  if (tokenSession.dailyUsed >= DAILY_BUDGET) {
    throw new Error(`Daily token budget (${DAILY_BUDGET}) exhausted. Try again tomorrow.`);
  }

  const primary  = normalizeModel(forceModel || PRIMARY_MODEL);
  const fallback = normalizeModel(fallbackModel || FALLBACK_MODEL);
  const chain = primary === fallback ? [primary] : [primary, fallback];

  const { system: sysRaw, messages: anthMessages } = toAnthropicMessages(messages, cacheSystem);
  const system = injectJsonInstruction(sysRaw, responseFormat);

  const errors = [];
  const client = getClient();

  for (const m of chain) {
    console.log(`[LLM] Trying model: ${m}`);
    try {
      const resp = await client.messages.create({
        model: m,
        max_tokens: maxTokens,
        temperature,
        ...(system !== undefined && { system }),
        messages: anthMessages,
      });

      recordUsage(resp.usage);

      const content = (resp.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');

      if (!content) throw new Error('Empty response from model');

      const usageOut = {
        prompt_tokens:     (resp.usage?.input_tokens || 0)
                          + (resp.usage?.cache_read_input_tokens || 0)
                          + (resp.usage?.cache_creation_input_tokens || 0),
        completion_tokens: resp.usage?.output_tokens || 0,
        total_tokens:      (resp.usage?.input_tokens || 0)
                          + (resp.usage?.output_tokens || 0)
                          + (resp.usage?.cache_read_input_tokens || 0)
                          + (resp.usage?.cache_creation_input_tokens || 0),
        cache_read_tokens:  resp.usage?.cache_read_input_tokens || 0,
        cache_write_tokens: resp.usage?.cache_creation_input_tokens || 0,
      };

      console.log(`[LLM] ✓ ${m} | Tokens: ${JSON.stringify(usageOut)}`);
      return { content, usage: usageOut, model: m, stats: getTokenStats() };

    } catch (err) {
      const status = err?.status || err?.response?.status;
      const errMsg = err?.error?.message || err?.message || String(err);
      console.warn(`[LLM] ✗ ${m} (${status || 'ERR'}): ${errMsg}`);
      errors.push(`${m}: ${errMsg}`);

      if (status === 401 || status === 403) {
        throw new Error(`Auth error (${status}): ${errMsg}. Check ANTHROPIC_API_KEY.`);
      }
      if (status === 402) {
        throw new Error(`Billing error: ${errMsg}. Top up at console.anthropic.com.`);
      }
      if (isRetryable(err)) {
        console.warn('[LLM] Transient error — trying fallback model...');
        continue;
      }
      // Hard failure (4xx other than rate limit): try fallback once anyway,
      // since model-specific 4xx shouldn't kill the request.
      if (status && status >= 400 && status < 500) {
        console.warn('[LLM] Model-specific 4xx — trying fallback...');
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `All models failed.\n${errors.slice(-2).join('\n')}\n` +
    `Check: 1) ANTHROPIC_API_KEY valid, 2) account has credits at console.anthropic.com.`
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
 * Falls back to FALLBACK_MODEL on transient errors before first token.
 */
async function completeStream({
  messages,
  temperature = 0.3,
  maxTokens = 2048,
  forceModel = null,
  fallbackModel = null,
  cacheSystem = false,
  onToken,
}) {
  checkDailyReset();
  if (tokenSession.dailyUsed >= DAILY_BUDGET) {
    throw new Error(`Daily token budget (${DAILY_BUDGET}) exhausted.`);
  }

  const primary  = normalizeModel(forceModel || PRIMARY_MODEL);
  const fallback = normalizeModel(fallbackModel || FALLBACK_MODEL);
  const chain = primary === fallback ? [primary] : [primary, fallback];

  const { system, messages: anthMessages } = toAnthropicMessages(messages, cacheSystem);

  const errors = [];
  const client = getClient();

  for (const m of chain) {
    console.log(`[LLM stream] Trying model: ${m}`);
    try {
      const stream = client.messages.stream({
        model: m,
        max_tokens: maxTokens,
        temperature,
        ...(system !== undefined && { system }),
        messages: anthMessages,
      });

      let content = '';
      stream.on('text', (delta, snapshot) => {
        content = snapshot;
        try { onToken?.(delta, snapshot); } catch {}
      });

      const finalMsg = await stream.finalMessage();
      recordUsage(finalMsg.usage);

      if (!content) {
        // finalMessage gives us full text even if no text events fired
        // (extremely short or non-text-only completions).
        content = (finalMsg.content || [])
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('');
      }
      if (!content) throw new Error('Empty stream from model');

      const usageOut = {
        prompt_tokens:     (finalMsg.usage?.input_tokens || 0)
                          + (finalMsg.usage?.cache_read_input_tokens || 0)
                          + (finalMsg.usage?.cache_creation_input_tokens || 0),
        completion_tokens: finalMsg.usage?.output_tokens || 0,
        total_tokens:      (finalMsg.usage?.input_tokens || 0)
                          + (finalMsg.usage?.output_tokens || 0)
                          + (finalMsg.usage?.cache_read_input_tokens || 0)
                          + (finalMsg.usage?.cache_creation_input_tokens || 0),
      };

      console.log(`[LLM stream] ✓ ${m} | Tokens: ${JSON.stringify(usageOut)}`);
      return { content, usage: usageOut, model: m, stats: getTokenStats() };

    } catch (err) {
      const status = err?.status || err?.response?.status;
      const errMsg = err?.error?.message || err?.message || String(err);
      console.warn(`[LLM stream] ✗ ${m} (${status || 'ERR'}): ${errMsg}`);
      errors.push(`${m}: ${errMsg}`);
      if (status === 401 || status === 402 || status === 403) {
        throw new Error(`Auth/billing error (${status}): ${errMsg}`);
      }
      if (isRetryable(err) || (status && status >= 400 && status < 500)) {
        continue;
      }
      throw err;
    }
  }

  throw new Error(`All models failed on stream.\n${errors.slice(-2).join('\n')}`);
}

/**
 * completeJSON — strict JSON completion with one structural fallback.
 *
 * Tries the requested model first. If JSON parse fails, retries on the
 * fallback model with the same prompt. Throws if both fail to produce
 * valid JSON.
 *
 * @param {object} args
 * @param {array}  args.messages
 * @param {object} [args.schema]            — { name, strict, schema } for json_schema mode.
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
  provider: _provider = null,  // eslint-disable-line no-unused-vars
  preferJsonObject = false,
}) {
  const responseFormat = (schema && !preferJsonObject)
    ? { type: 'json_schema', json_schema: schema }
    : { type: 'json_object' };

  const tryOnce = async (model) => {
    const result = await complete({
      messages,
      temperature,
      maxTokens,
      forceModel: model,
      // Disable internal fallback inside complete() — completeJSON owns it
      // here so JSON-parse failures (not transport failures) drive the
      // escalation.
      fallbackModel: model,
      responseFormat,
      cacheSystem,
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
    return {
      json: primary.parsed,
      model: primary.result.model,
      usage: primary.result.usage,
      stats: primary.result.stats,
      fallback: false,
    };
  }

  if (fallbackModel) {
    console.warn(`[LLM] completeJSON: primary returned non-parseable JSON, escalating to ${fallbackModel}`);
    const secondary = await tryOnce(fallbackModel);
    if (secondary.parsed) {
      return {
        json: secondary.parsed,
        model: secondary.result.model,
        usage: secondary.result.usage,
        stats: secondary.result.stats,
        fallback: true,
      };
    }
  }

  throw new Error(
    'completeJSON: model produced non-parseable JSON on primary'
    + (fallbackModel ? ' and fallback' : '') + '.'
  );
}

module.exports = {
  complete,
  completeJSON,
  completeStream,
  parseJSON,
  smartTruncate,
  estimateTokens,
  getTokenStats,
  MODEL_CHAIN,
  applyPromptCache,
};
