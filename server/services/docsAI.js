'use strict';
const { getDb } = require('./db');

function sanitizeForFTS(s) {
  return String(s || '').replace(/["'\\-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function safeJson(s) {
  if (s == null) return [];
  try { return JSON.parse(s); } catch { return []; }
}

async function retrieveCards(query, k = 10) {
  const q = sanitizeForFTS(query);
  if (!q) return [];
  let rows;
  try {
    rows = getDb().prepare(`
      SELECT c.id, c.tag, c.shortCite, substr(c.body_plain, 1, 400) AS body_plain,
             c.argumentTypes, c.argumentTags, c.typeLabel, c.topicLabel,
             bm25(cards_fts) AS rank
      FROM cards_fts
      JOIN cards c ON c.rowid = cards_fts.rowid
      WHERE cards_fts MATCH ? AND c.isCanonical = 1
      ORDER BY rank ASC
      LIMIT ?
    `).all(q, k);
  } catch (e) {
    // FTS match syntax rejection — fallback to LIKE on tag
    rows = getDb().prepare(`
      SELECT id, tag, shortCite, substr(body_plain, 1, 400) AS body_plain,
             argumentTypes, argumentTags, typeLabel, topicLabel
      FROM cards
      WHERE isCanonical = 1 AND (tag LIKE ? OR shortCite LIKE ?)
      LIMIT ?
    `).all('%' + q + '%', '%' + q + '%', k);
  }
  return rows.map(r => ({
    ...r,
    argumentTypes: safeJson(r.argumentTypes),
    argumentTags:  safeJson(r.argumentTags),
  }));
}

async function retrieveAnalytics(query, k = 5) {
  const q = sanitizeForFTS(query);
  if (!q) return [];
  try {
    return getDb().prepare(`
      SELECT a.id, a.title, substr(a.content_plain, 1, 500) AS content_plain,
             bm25(analytics_fts) AS rank
      FROM analytics_fts
      JOIN analytics a ON a.rowid = analytics_fts.rowid
      WHERE analytics_fts MATCH ?
      ORDER BY rank ASC
      LIMIT ?
    `).all(q, k);
  } catch {
    return [];
  }
}

function headingContextText(headings = {}) {
  const lines = [];
  if (headings.h1) lines.push(`Pocket: ${headings.h1}`);
  if (headings.h2) lines.push(`Hat: ${headings.h2}`);
  if (headings.h3) lines.push(`Block: ${headings.h3}`);
  return lines.join('\n') || '(no surrounding headings)';
}

function buildBlockPrompt({ intent, headings = {}, cards = [], analytics = [] }) {
  const ctx = headingContextText(headings);
  const cardList = cards.map((c, i) =>
    `[${i + 1}] id=${c.id}\n    tag=${c.tag}\n    cite=${c.shortCite}\n    types=${(c.argumentTypes || []).join(',')}\n    topics=${(c.argumentTags || []).join(',')}\n    body=${c.body_plain}`
  ).join('\n---\n') || '(no cards found)';
  const refs = analytics.map((a, i) =>
    `[A${i + 1}] ${a.title || ''}\n${a.content_plain}`
  ).join('\n---\n') || '(no analytic refs)';
  return `You are a competitive debate assistant building a block for a Verbatim file.

Context (surrounding headings):
${ctx}

Debater intent: ${intent}

Candidate cards from the debater's library (pick 1-3 that fit best):
${cardList}

Reference analytic passages from the library (use for voice and domain detail, not verbatim):
${refs}

Instructions:
- Choose 1-3 cards that best support the intent.
- Write a sharp H4 tag summarizing the block's claim.
- Optionally write 1-3 short sentences of analytic glue before, between, or after the cards.
- Ground claims in retrieved references + your own debate knowledge.
- Return JSON: {"tag": "...", "pickedCardIds": [...], "analyticBefore": "...", "glueBetween": ["...", "..."], "analyticAfter": "..."}
- Omit empty analytic fields rather than padding.`;
}

function buildAnalyticPrompt({ intent, headings = {}, analytics = [] }) {
  const ctx = headingContextText(headings);
  const refs = analytics.map((a, i) => `[A${i + 1}] ${a.content_plain}`).join('\n---\n') || '(no refs)';
  return `You are writing a SHORT debate analytic paragraph (1-3 sentences max).

Context:
${ctx}

Intent: ${intent}

Reference passages:
${refs}

Return JSON: {"text": "..."} with 1-3 sentences, grounded in references + trained debate knowledge.`;
}

module.exports = { retrieveCards, retrieveAnalytics, buildBlockPrompt, buildAnalyticPrompt };
