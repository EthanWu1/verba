'use strict';

const BLOCK_INTENT = /write.*block|block (to|against|on|for)|frontline|extend\b|overview/i;

const SHORT_BRIEF = `LENGTH DEFAULT — STRICT:
- Default to 1–2 short sentences. Answer the asked question, nothing more. Never restate the question, add setup, or trail off with a summary.
- Single-sentence answers are preferred when they suffice.
- Only go longer when the user EXPLICITLY asks for a block, frontline, overview, long explanation, full case, detailed walkthrough, or multiple labeled responses (Turn./Perm./etc — those require the labeled-paragraph format).
- Ambiguous or philosophical prompts: still answer in 1–2 sentences. No padding.`;

function pickChatMaxTokens(lastUserMsg) {
  return BLOCK_INTENT.test(String(lastUserMsg || '')) ? 1500 : 220;
}

module.exports = { pickChatMaxTokens, SHORT_BRIEF, BLOCK_INTENT };
