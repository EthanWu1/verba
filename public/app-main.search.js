'use strict';
function filterEvidenceClient(cards, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return cards.slice();
  return cards.filter((c) => {
    const hay = [c.tag, c.cite, c.shortCite, c.body_plain, c.body_markdown, c.topic, c.topicLabel]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(needle);
  });
}
if (typeof module !== 'undefined') module.exports = { filterEvidenceClient };
if (typeof window !== 'undefined') window.__filterEvidenceClient = filterEvidenceClient;
