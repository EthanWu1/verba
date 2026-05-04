'use strict';

/**
 * tagSuggester.js — generate 3 candidate tags for a source article.
 *
 * Input: source body + optional metadata.
 * Output: array of 3 tags spanning different framings (impact / mechanism /
 * turn) so the user can pick the angle they want.
 *
 * Tags are constrained the same way the cutter constrains them:
 *   - 7–13 words, AS SHORT AS POSSIBLE
 *   - period-terminated (no em dashes)
 *   - offensive / claim-shaped (not descriptive of article)
 */

function buildTagSuggesterSystemPrompt() {
  return `You are an LD debate tag-writer. Given a source article, produce THREE candidate offensive tags a debater could use to cut the article.

RULES for each tag:
  - 7–13 words. AS SHORT AS POSSIBLE while still carrying mechanism + magnitude.
  - Period-terminated. NO em dashes (—). Hyphens are fine.
  - Offensive / claim-shaped — what the debater is ARGUING, not what the article describes.
  - Each of the 3 tags should approach a DIFFERENT angle:
    1. IMPACT framing: highlights the magnitude/consequence ("…goes nuclear and draws in Russia and China.")
    2. MECHANISM framing: highlights the causal pathway ("Forward deployment triggers overreaction in a crisis.")
    3. TURN/CONTRAST framing: flips a likely opposing claim ("Diplomacy fails. Threats not abating, ignoring backfires.")

EXAMPLES of good tags:
  - "Forward deployment destabilizes the region. Goes nuclear, draws in Russia and China."
  - "US nuclear primacy is a dangerous illusion. Limited nuclear war escalates."
  - "Debates must center the preconscious. Grammar represses pain."
  - "Nuclear policy is constituted by racialized violence and white fantasy."

EXAMPLES of BAD tags (do NOT do these):
  - "This article discusses North Korea's missile tests" (descriptive, not offensive)
  - "Forward deployment of US tactical nuclear weapons in South Korea would have implications for regional security and could potentially destabilize the area" (way too long)
  - "Nukes — bad" (too short, no mechanism)
  - "Trump's policy fails — disaster looms" (em dash forbidden)

OUTPUT — JSON ONLY, no prose, no fence:
{ "tags": ["tag 1", "tag 2", "tag 3"] }`;
}

function buildTagSuggesterUserPrompt({ bodyText = '', meta = {} } = {}) {
  const truncated = String(bodyText || '').slice(0, 6000);  // cap input tokens
  const metaLines = [
    meta.title  && `Title: ${meta.title}`,
    meta.author && `Author: ${meta.author}`,
    meta.date   && `Date: ${meta.date}`,
    meta.source && `Source: ${meta.source}`,
  ].filter(Boolean).join('\n');

  return [
    metaLines && `ARTICLE METADATA:\n${metaLines}`,
    `ARTICLE BODY (first ~6000 chars):\n---\n${truncated}\n---`,
    'Return JSON now. Three tags, three different angles.',
  ].filter(Boolean).join('\n\n');
}

module.exports = {
  buildTagSuggesterSystemPrompt,
  buildTagSuggesterUserPrompt,
};
