'use strict';

const express = require('express');
const router = express.Router();
const { complete } = require('../services/llm');
const { getRelevantAnalytics, buildChatContext } = require('../services/libraryQuery');
const requireUser = require('../middleware/requireUser');
const enforceLimit = require('../middleware/enforceLimit');
const { pickChatMaxTokens, SHORT_BRIEF, BLOCK_INTENT } = require('../prompts/chatBrevity');
const CHAT_DAILY_LIMIT = Number(process.env.FREE_CHAT_DAILY || 10);
router.use(requireUser);

const SYSTEM_PROMPT = `You are a circuit LD debate coach. Direct claims only. No greetings, filler, hedging, or offers to tailor further.

OUTPUT FORMAT — STRICT:
- Plain text only. No markdown. No **bold**, no *italic*, no _underline_, no backticks, no headings.
- Separate ideas with a blank line. Each labeled response is its own paragraph.
- Never end with a question, offer, or "want me to...". Just stop.

BLOCK WRITING:
- First line of a block is: "AT: <argument name>" (e.g. "AT: Moral Skepticism", "AT: Econ DA").
- Then blank line.
- Then labeled responses, one per paragraph. Label starts the paragraph, followed by a period:
    Turn. <1-3 sentences>
    Non-unique. <...>
    Perm. <...>  (only CPs / Ks)
    Link turn. <...>  (K)
    Framework preempt. <...>  (phil)
    Collapse. <...>  (phil)
    Counterinterp. Fairness. Clash. Predictability. Reasonability. (theory only)

Valid labels per type:
  DA:     Turn. Non-unique. No link. No internal link. Impact defense. Timeframe.
  CP:     Perm. Non-unique. Solvency deficit. Net benefit turns.
  K:      Perm. Link turn. No impact. Alt fails. Framework.
  Theory: Counterinterp. Fairness. Clash. Predictability. Reasonability. Drop the arg.
  Phil:   Turn. Collapse. Framework preempt.

Lead with offense (Turn. or Perm.). Each label 1-3 sentences, no padding.

CARD REFERENCES:
When you want to cite evidence, do NOT paste the card text into the response. Emit a card token instead:
  [[CARD|<id>|Author 'YY|QualShort|One-line preview of the warrant]]
Example: [[CARD|a3f9b21c|Korsgaard '96|Harvard Phil|Reflective consciousness makes normativity inescapable]]
The UI renders these as chips the user can click to save. Never quote card body text inline. Never write <u>...</u> or ==...==.

STYLE:
- Short sentences. Warrant > claim > impact in that order when laying out a response.
- No preamble. No "Here's a block on...". Start with the "AT:" line.
- No closing summary. No "let me know if...".

${SHORT_BRIEF}`;

router.post('/', enforceLimit('chat', CHAT_DAILY_LIMIT), async (req, res) => {
  const { messages, fileContext } = req.body;
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages array required' });
  }

  try {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    let systemContent = SYSTEM_PROMPT;

    if (BLOCK_INTENT.test(lastUserMsg)) {
      const refs = getRelevantAnalytics(lastUserMsg, 3);
      if (refs.length) {
        systemContent += '\n\nREFERENCE BACKFILES (inspiration only — adapt and reword to fit this specific argument; skip anything that does not directly address it; do not quote verbatim):\n' +
          refs.map(r => `--- ${r.title} ---\n${String(r.content_plain || '').slice(0, 1500)}`).join('\n\n');
      }
    }

    if (fileContext) {
      systemContent += '\n\nUPLOADED FILE CONTEXT (user attached this for reference):\n' +
        String(fileContext).slice(0, 4000);
    }

    let contextCards = [];
    try {
      const ctx = await buildChatContext(lastUserMsg, {}, 24);
      const all = Array.isArray(ctx && ctx.cards) ? ctx.cards : [];
      // Only surface cards that actually have highlights/underlines — unhighlighted cards read poorly.
      const hasMarkup = (c) => {
        if (c.hasHighlight === 1 || c.hasHighlight === true) return true;
        const body = String(c.body_markdown || c.body_html || '');
        return /<u[>\s]|==|\*\*/.test(body);
      };
      const highlighted = all.filter(hasMarkup);
      contextCards = (highlighted.length ? highlighted : all).slice(0, 8);
    } catch (e) {
      contextCards = [];
    }

    if (contextCards.length) {
      systemContent += '\n\nAVAILABLE CARDS (cite by ID using the [[CARD|<id>|...]] token; only use IDs listed here):\n' +
        contextCards.map(c => {
          const preview = String(c.body_plain || c.body_markdown || '').slice(0, 400);
          return `ID: ${c.id}\nTag: ${c.tag || ''}\nCite: ${c.cite || ''}\nBody: ${preview}`;
        }).join('\n---\n') +
        '\n\nCARD STANCE MATCHING — HARD RULE:\n' +
        '- Read the USER REQUEST and determine the exact stance/claim asked for (e.g. "nukes good for earth" vs "nukes bad for earth").\n' +
        '- Before emitting a [[CARD|...]] token, verify that the card BODY actually argues the requested stance. Skim the Tag AND Body preview — do not rely on keyword overlap. A card about "nukes bad" does NOT support "nukes good".\n' +
        '- If NO card in the list supports the requested stance, say so in plain text: "No matching card in library." Do not emit a chip. Do not substitute an opposite-stance card.\n' +
        '- Never cite a card whose warrant contradicts the user\'s requested claim.';
    }

    const result = await complete({
      messages: [
        { role: 'system', content: systemContent },
        ...messages.slice(-20),
      ],
      temperature: 0.4,
      maxTokens: pickChatMaxTokens(lastUserMsg),
      forceModel: process.env.CHAT_MODEL || 'anthropic/claude-opus-4-7',
    });
    const cardsPayload = contextCards.map(c => ({
      id: c.id,
      tag: c.tag,
      cite: c.cite,
      shortCite: c.shortCite,
      body_markdown: c.body_markdown,
      body_plain: c.body_plain,
      body_html: c.body_html,
    }));
    res.json({ reply: result.content, model: result.model, cards: cardsPayload });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
