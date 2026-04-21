'use strict';

const BLOCK_INTENT = /write.*block|block (to|against|on|for)|frontline|extend\b|overview/i;

const SHORT_BRIEF = `LENGTH DEFAULT — STRICT:
- Default to ≤4 short sentences. Do NOT pad with restatement, setup, or summary.
- Only exceed 4 sentences when the user explicitly asks for a block, frontline, overview, long explanation, full case, or multiple labeled responses (Turn./Perm./etc — those require the labeled-paragraph format).
- For "what", "why", "explain briefly": answer in 1–3 sentences. Stop.`;

function pickChatMaxTokens(lastUserMsg) {
  return BLOCK_INTENT.test(String(lastUserMsg || '')) ? 1500 : 450;
}

module.exports = { pickChatMaxTokens, SHORT_BRIEF, BLOCK_INTENT };
