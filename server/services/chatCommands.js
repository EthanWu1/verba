'use strict';

const SLASH_RE = /^\s*\/(explain|analytic|block)\b\s*(.*)$/is;

// Natural-language detection for "give me a block / make a block / block on X".
// Conservative — only fires on imperative phrasing or "block <preposition>"
// patterns. Won't trip on "I'll block that argument" or "what's a block".
const NL_BLOCK_RE = new RegExp(
  '(?:' +
    '\\b(?:make|build|create|write|cut|draft|need|want|give\\s+me|gimme|prepare)\\s+' +
    '(?:a|me\\s+a)?\\s*' +
    '(?:1ar|2ar|1nr|2nr|aff|neg)?\\s*block' +
  '|' +
    '\\bblock\\s+(?:on|about|for|against|vs\\.?|to)\\b' +
  ')',
  'i'
);

// Same posture for /explain — natural-language "explain X" / "what is X" should
// still feel snappy without forcing the slash.
const NL_EXPLAIN_RE = /^\s*(?:explain|what'?s|what is|tell me about|how does)\b\s*(.+)$/i;

function parseCommand(text) {
  const s = String(text || '');
  const m = s.match(SLASH_RE);
  if (m) return { command: '/' + m[1].toLowerCase(), intent: m[2].trim() };

  if (NL_BLOCK_RE.test(s)) {
    // Strip imperative scaffolding so the prompt receives the topic only.
    const intent = s
      .replace(/^\s*(?:hey|hi|please|yo)\s*[,:]?\s*/i, '')
      .replace(/\b(?:can|could|would)\s+you\s+/gi, '')
      .replace(/\bi'?d?\s+(?:like|need|want)\s+(?:to\s+)?(?:have\s+)?/gi, '')
      .replace(/\b(?:gimme|give me|make me|build me|create me|cut me|draft me|prepare me)\s+/gi, '')
      .replace(NL_BLOCK_RE, '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
      .trim();
    return { command: '/block', intent: intent || s.trim() };
  }

  const em = s.match(NL_EXPLAIN_RE);
  if (em) {
    return { command: '/explain', intent: em[1].trim() };
  }

  return { command: null, intent: s.trim() };
}

function buildExplainPrompt({ intent, context = [], contextDocs = [] }) {
  const refs = context.map((a, i) => `[A${i + 1}] ${a.content_plain}`).join('\n---\n') || '(no refs)';
  const userDocs = contextDocs.map((d, i) => `[U${i + 1}] ${d.content_plain}`).join('\n---\n') || '(no user docs)';
  return `You are a competitive debate assistant. Answer clearly and concisely.

User question: ${intent}

Relevant analytic passages from library:
${refs}

User's own uploaded context:
${userDocs}

Write a clear debate-oriented answer. Ground in refs when applicable; use your own debate knowledge to fill gaps. No JSON — plain prose.`;
}

function buildAnalyticPrompt({ intent, headings = {}, analytics = [], contextDocs = [] }) {
  const refs = analytics.map((a, i) => `[A${i + 1}] ${a.content_plain}`).join('\n---\n') || '(no refs)';
  const userDocs = contextDocs.map((d, i) => `[U${i + 1}] ${d.content_plain}`).join('\n---\n') || '(no user docs)';
  return `Write a SHORT debate analytic paragraph (1-3 sentences max) for the following intent.

Intent: ${intent}

Reference analytic passages:
${refs}

User's own context:
${userDocs}

Return plain prose only (no JSON). 1-3 sentences.`;
}

function buildBlockPrompt({ intent, headings = {}, cards = [], analytics = [], contextDocs = [] }) {
  const cardList = cards.map((c, i) =>
    `[${i + 1}] id=${c.id}\n    tag=${c.tag}\n    cite=${c.shortCite}\n    types=${(c.argumentTypes || []).join(',')}\n    topics=${(c.argumentTags || []).join(',')}\n    body=${c.body_plain}`
  ).join('\n---\n') || '(no cards)';
  const refs = analytics.map((a, i) => `[A${i + 1}] ${a.content_plain}`).join('\n---\n') || '(no refs)';
  return `You build a debate block for intent: ${intent}

Candidate cards from the debater's library (pick 1-3):
${cardList}

Reference analytic passages (for voice/detail):
${refs}

Instructions:
- Pick 1-3 best cards.
- Write a sharp H4 tag summarizing the block's claim.
- Optionally add short analytic glue before/between/after cards.
- Return ONLY JSON: {"tag":"...","pickedCardIds":[...],"analyticBefore":"...","glueBetween":["...","..."],"analyticAfter":"..."}`;
}

module.exports = { parseCommand, buildExplainPrompt, buildAnalyticPrompt, buildBlockPrompt };
