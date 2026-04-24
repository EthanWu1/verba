'use strict';

const SLASH_RE = /^\s*\/(explain|analytic|block)\b\s*(.*)$/is;

function parseCommand(text) {
  const s = String(text || '');
  const m = s.match(SLASH_RE);
  if (!m) return { command: null, intent: s.trim() };
  return { command: '/' + m[1].toLowerCase(), intent: m[2].trim() };
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
