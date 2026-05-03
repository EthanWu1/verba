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

// Domain anchor — read EVERY user query through a debate lens. The chat
// is a competitive-debate assistant; ambiguous terms collapse to debate
// meaning, never general English. "Condo" = conditionality (NOT
// condominium). "Plan" = policy advocacy. "Tag" = card label.
const DEBATE_DOMAIN_ANCHOR = `DOMAIN — competitive Lincoln-Douglas / policy debate ONLY:
- Interpret EVERY query through the debate lens. Never the general-English meaning.
- Common term map (use as defaults, never gloss to the user):
  · condo = conditionality (theory shell about multiple conditional negative advocacies)
  · T = topicality
  · CP = counterplan · PIC = plan-inclusive CP · process / consult / states / NFU / CIL CPs
  · DA = disadvantage · politics / econ / heg / climate / nuke war / prolif DAs
  · K = kritik · cap K · settler K · psycho K · pess K
  · NC = negative case · AC = affirmative case · 1AC/1NC/2AC/2NC/1AR/2AR/3NR speech codes
  · Plan = AFF advocacy text · Perm = permutation · Sever / Intrinsic = perm types
  · Framework / FW = ethical or decision-rule layer (util, deont, contractualism, skep, tricks)
  · OV = overview · UV/UQ = uniqueness · IL = internal link · MPX/IMP = impact · SQ = squo
  · Skep = moral skepticism · Tricks = framing / a-priori shortcuts (NIBs, RVI, monism, indexicals)
  · Theory shells = NIBs bad, condo bad, AFC, disclosure, RVIs good, PICs bad, etc.
  · "AT —" / "AT:" / "answers to" / "responses to" / "answering X" / "ans to X" =
    arguments AGAINST X. If the user asks "answers to condo" they want NEG-side
    responses to the conditionality shell, NOT a conditionality shell. Lead the
    answer with "AT: Conditionality" or "AT — Condo".
- If the query is genuinely outside debate (e.g. "what's the weather"), say so briefly and stop.`;

// Voice rules for chat replies (explain / analytic). Numbered analytic format
// (1] LABEL. warrant. impact.) is GOOD when listing 2+ distinct responses —
// each numbered point on its OWN paragraph (blank-line separated) so the
// chat UI doesn't collapse them. Single-claim answers stay as short prose.
const CHAT_VOICE_RULES = `STYLE — STRICT (chat reply, debate analytic voice):
- NO introduction. NO "Here's…", "Sure thing", "Great question", "Let me explain". Start with the answer.
- NO conclusion. NO "In summary", "Overall", "I hope this helps", "TL;DR". Stop when the answer is done.
- NO formatting markup. NO **bold**, NO *italic*, NO <u>underline</u>, NO ==highlight==, NO #headings. Plain text only.
- NO redundant phrasings. Cut filler ("this means", "this simulates", "in turn", "as a result", "ultimately", "because X means Y means Z"). Direct claim → terse warrant → impact.
- For LISTS of responses / answers / turns / warrants (2+ items): use numbered analytic format:

    1] LABEL. Terse warrant. Impact.

    2] LABEL. Terse warrant. Impact.

    3] LABEL. ...

  · Each numbered point on its OWN paragraph, blank line between.
  · LABEL = 1–4 ALLCAPS words naming the move (TOPIC EDUCATION, REAL WORLD, REASONABILITY, NO LINK, NO IMPACT, TURN, TIMESKEW, ARBITRARY, NEG FLEX). Always include a label.
  · Use square-bracket notation 1] 2] 3] (debate-flow convention). Not 1. or (1).
  · Open with a one-line stance ("AT: Conditionality" or "Conditionality is good –") before the first numbered point.
- For SINGLE-CLAIM answers or pure explanations: short prose paragraphs separated by BLANK lines. No numbering needed.
- Length: explanations can be 2–5 paragraphs (err on completeness, never pad). Lists of responses can be 3–6 numbered points. Single-claim answers 1–2 sentences.
- Voice: terse, declarative, debate-flow style. Like a debater on the flow, not a textbook.
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

${DEBATE_DOMAIN_ANCHOR}

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

${DEBATE_DOMAIN_ANCHOR}

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

${DEBATE_DOMAIN_ANCHOR}

Candidate cards from the debater's library (pick 1–2 most relevant):
${cardList}

Reference analytic passages (for voice/detail — DO NOT quote, just match style):
${refs}

Instructions:
- Pick the 1–2 most relevant cards.
- Write a debate-FILE-style title for "tag" — name what kind of block this IS, not just the claim. Examples:
    · "Conditionality Shell" (NEG theory)
    · "AT: Conditionality" (AFF answers to NEG theory)
    · "AT: Moral Skepticism" (responses to skep)
    · "Plan Focus 2NR"
    · "Cap K Frontline"
    · "Politics DA – 1AC"
    · "AT: Permutation"
    · "Framework — 1AR Extension"
  Avoid generic claim summaries like "Conditionality is good" or "Why X matters". Use the canonical block-file naming the debater would search by.
- analyticBefore (optional, 1–2 SHORT sentences): set up the card. Plain prose. NO commentary on the card body.
- glueBetween (optional, 1 short sentence per gap): bridge between cards if you pick 2.
- analyticAfter (optional, 1 short sentence): wrap the implication. NO summary of what the card said.
- DO NOT write any "explanation" of the card content — the card body speaks for itself.
- The renderer pastes each card's body_markdown verbatim with all <u>, **, == markup intact. You do NOT need to reproduce or modify the card body.
- Return ONLY JSON: {"tag":"...","pickedCardIds":[...],"analyticBefore":"...","glueBetween":["..."],"analyticAfter":"..."}`;
}

module.exports = { parseCommand, buildExplainPrompt, buildAnalyticPrompt, buildBlockPrompt };
