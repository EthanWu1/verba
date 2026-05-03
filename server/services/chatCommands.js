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

// Voice rules for chat replies (explain / analytic). Plain prose, no
// formatting markup — chat replies are read in a chat UI, not a debate
// document, so **bold** / <u>underline</u> / 1. lists either don't render
// (and leak raw chars) or pile a numbered structure where prose would do.
// /block takes its own formatting rules in buildBlockPrompt.
const CHAT_VOICE_RULES = `STYLE — STRICT (chat reply, plain prose):
- NO introduction. NO "Here's…", "Sure thing", "Great question", "Let me explain". Start with the answer.
- NO conclusion. NO "In summary", "Overall", "I hope this helps", "TL;DR". Stop when the answer is done.
- NO formatting markup at all. NO **bold**, NO *italic*, NO <u>underline</u>, NO ==highlight==, NO #headings. Plain text only.
- NO numbered lists (1. 2. 3.) and NO bullet lists (-, •) unless the user explicitly asks for one. Default to prose.
- Separate distinct ideas with a BLANK LINE (i.e. \\n\\n between paragraphs). Each new claim or warrant gets its own paragraph.
- Length: 1–4 short paragraphs. Most questions get 1–2 paragraphs. Never pad.
- Voice: terse, declarative, debate-flow style. Direct answer first, warrant second, impact or link third.
- Markdown code blocks allowed only if the user is asking about code.`;

function buildExplainPrompt({ intent, context = [], contextDocs = [] }) {
  const refs = context.map((a, i) => `[A${i + 1}] ${a.content_plain}`).join('\n---\n') || '(no refs)';
  const userDocs = contextDocs.map((d, i) => `[U${i + 1}] ${d.content_plain}`).join('\n---\n') || '(no user docs)';
  return `You are a competitive debate assistant.

Question: ${intent}

Reference analytic passages from the library (THESE ARE YOUR STYLE REFERENCE — match their terseness, structure, and debate vocabulary):
${refs}

User's uploaded context:
${userDocs}

${CHAT_VOICE_RULES}

Answer the question directly. Ground in refs when applicable; use your own debate knowledge to fill gaps. Plain prose only — no JSON, no preamble, no closing. Start the answer with the substantive content. End when the answer is complete.`;
}

function buildAnalyticPrompt({ intent, headings = {}, analytics = [], contextDocs = [] }) {
  const refs = analytics.map((a, i) => `[A${i + 1}] ${a.content_plain}`).join('\n---\n') || '(no refs)';
  const userDocs = contextDocs.map((d, i) => `[U${i + 1}] ${d.content_plain}`).join('\n---\n') || '(no user docs)';
  return `Write a single debate analytic block for: ${intent}

Reference analytic passages (match their terseness and voice exactly):
${refs}

User's context:
${userDocs}

${CHAT_VOICE_RULES}

Return ONE paragraph (1–3 sentences). Direct claim → warrant → impact. No preamble, no closing, no headings.`;
}

function buildBlockPrompt({ intent, headings = {}, cards = [], analytics = [], contextDocs = [] }) {
  // Pass FULL formatted card body (body_markdown carries <u>...</u>, **...**,
  // ==...== verbatim from the highlighter). The renderer pastes it inline
  // unmodified — no commentary, no paraphrase, no truncation.
  const cardList = cards.map((c, i) =>
    `[${i + 1}] id=${c.id}\n    tag=${c.tag}\n    cite=${c.shortCite}\n    types=${(c.argumentTypes || []).join(',')}\n    topics=${(c.argumentTags || []).join(',')}\n    body_markdown:\n${c.body_markdown || c.body_plain || ''}`
  ).join('\n---\n') || '(no cards)';
  const refs = analytics.map((a, i) => `[A${i + 1}] ${a.content_plain}`).join('\n---\n') || '(no refs)';
  return `You build a debate block for: ${intent}

Candidate cards from the debater's library (pick 1–2 most relevant):
${cardList}

Reference analytic passages (for voice/detail — DO NOT quote, just match style):
${refs}

Instructions:
- Pick the 1–2 most relevant cards.
- Write a sharp H4 tag (≤12 words) summarizing the block's claim.
- analyticBefore: 1–2 short sentences setting up the card. Optional. Plain prose.
- glueBetween: 1 short sentence between cards if you pick 2. Optional.
- analyticAfter: 1 short sentence wrapping the implication. Optional.
- DO NOT write any "explanation" of the card content — the card body speaks for itself; the analytics only frame it.
- The renderer pastes each card's body_markdown verbatim with all <u>, **, == markup intact. You do NOT need to reproduce or modify the card body.
- Return ONLY JSON: {"tag":"...","pickedCardIds":[...],"analyticBefore":"...","glueBetween":["..."],"analyticAfter":"..."}`;
}

module.exports = { parseCommand, buildExplainPrompt, buildAnalyticPrompt, buildBlockPrompt };
