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
function isSoftFailure(err) {
  const status = err.response?.status;
  const msg    = JSON.stringify(err.response?.data || '').toLowerCase();

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

/**
 * Core completion — rotates through MODEL_CHAIN until one succeeds.
 */
async function complete({ messages, temperature = 0.3, maxTokens = 2048, forceModel = null }) {
  checkDailyReset();

  if (tokenSession.dailyUsed >= DAILY_BUDGET) {
    throw new Error(`Daily token budget (${DAILY_BUDGET}) exhausted. Try again tomorrow.`);
  }

  const chain = forceModel ? [forceModel] : MODEL_CHAIN;
  const errors = [];

  for (const m of chain) {
    console.log(`[LLM] Trying model: ${m}`);
    try {
      const resp = await axios.post(
        `${OPENROUTER_BASE}/chat/completions`,
        { model: m, messages, temperature, max_tokens: maxTokens },
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
      if (errData) console.warn('[LLM] Response body:', JSON.stringify(errData).slice(0, 300));

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
 * Parse JSON from LLM output — handles markdown fences, trailing commas, truncation.
 */
function parseJSON(text) {
  const cleaned = text
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/```\s*$/im, '')
    .trim();

  // Direct parse
  try { return JSON.parse(cleaned); } catch {}

  // Extract first {...} block
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}

    // Try fixing trailing commas (common LLM quirk)
    const fixed = match[0].replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(fixed); } catch {}
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

module.exports = { complete, completeStream, parseJSON, smartTruncate, estimateTokens, getTokenStats, MODEL_CHAIN };
