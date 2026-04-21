'use strict';

const MAX_RUN_WORDS = 5;

const HIGHLIGHT_CAPS = {
  minimal:  0.30,
  standard: 0.40,
  heavy:    0.50,
};

const UNDERLINE_CAPS = {
  minimal:  0.40,
  standard: 0.55,
  heavy:    0.72,
};

function stripMarks(text) {
  return String(text || '')
    .replace(/==/g, '')
    .replace(/\*\*/g, '')
    .replace(/<\/?u>/gi, '');
}

function wordCount(text) {
  const t = stripMarks(text).trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function getHighlightRuns(paragraph) {
  const runs = [];
  const re = /==([^=]+)==/g;
  let m;
  while ((m = re.exec(paragraph)) !== null) {
    runs.push(stripMarks(m[1]).trim());
  }
  return runs;
}

function getUnderlineRuns(paragraph) {
  const runs = [];
  const re = /<u>([\s\S]*?)<\/u>/gi;
  let m;
  while ((m = re.exec(paragraph)) !== null) {
    runs.push(stripMarks(m[1]).trim());
  }
  return runs;
}

function splitParagraphs(body) {
  return String(body || '')
    .split(/\n\s*\n+/)
    .map(p => p.trim())
    .filter(p => p && p !== '[FIGURE OMITTED]');
}

// Collect spans outside any <u>…</u> region.
function outsideUnderlineSpans(paragraph) {
  const out = [];
  const re = /<u>([\s\S]*?)<\/u>/gi;
  let last = 0;
  let m;
  while ((m = re.exec(paragraph)) !== null) {
    if (m.index > last) out.push(paragraph.slice(last, m.index));
    last = m.index + m[0].length;
  }
  if (last < paragraph.length) out.push(paragraph.slice(last));
  return out;
}

function normalizeForMatch(s) {
  return stripMarks(s)
    .replace(/\u00B6/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .trim()
    .toLowerCase();
}

function buildSourceParagraphIndex(sourceText) {
  return splitParagraphs(sourceText).map(normalizeForMatch).filter(Boolean);
}

function validateCut(bodyMarkdown, sourceText = '', opts = {}) {
  const density = opts.density || 'heavy';
  const underlineCap = UNDERLINE_CAPS[density] ?? UNDERLINE_CAPS.heavy;
  const highlightCap = HIGHLIGHT_CAPS[density] ?? HIGHLIGHT_CAPS.heavy;
  const paragraphs = splitParagraphs(bodyMarkdown);
  const issues = [];
  const sourceParas = sourceText ? buildSourceParagraphIndex(sourceText) : [];
  const sourceJoined = sourceParas.join(' \u00A7 ');

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const runs = getHighlightRuns(p);
    const totalWords = wordCount(p);
    if (!totalWords) continue;

    const highlightedWords = runs.reduce((sum, r) => sum + wordCount(r), 0);
    const ratio = highlightedWords / totalWords;

    if (ratio > highlightCap) {
      issues.push(
        `Paragraph ${i + 1}: ${Math.round(ratio * 100)}% highlighted (max ${Math.round(highlightCap * 100)}% for "${density}"). Shrink highlight runs to 1–5 words each; leave ≥${100 - Math.round(highlightCap * 100)}% of words unhighlighted.`
      );
    }

    const uRuns = getUnderlineRuns(p);
    const underlinedWords = uRuns.reduce((sum, r) => sum + wordCount(r), 0);
    const uRatio = underlinedWords / totalWords;
    if (uRatio > underlineCap) {
      issues.push(
        `Paragraph ${i + 1}: ${Math.round(uRatio * 100)}% underlined (max ${Math.round(underlineCap * 100)}% for "${density}"). Remove filler/transitional sentences from <u>…</u> — underline ONLY clauses that carry the warrant.`
      );
    }

    const longRuns = runs.filter(r => wordCount(r) > MAX_RUN_WORDS);
    if (longRuns.length) {
      issues.push(
        `Paragraph ${i + 1}: highlight run exceeds ${MAX_RUN_WORDS} words — "${longRuns[0].slice(0, 80)}". Break into shorter 1–5 word runs.`
      );
    }

    const outside = outsideUnderlineSpans(p).join(' ');
    if (/==[^=]+==/.test(outside)) {
      issues.push(`Paragraph ${i + 1}: ==highlight== appears outside <u>…</u>. Every highlight must sit inside an underline.`);
    }
    if (/\*\*[^*]+\*\*/.test(outside)) {
      issues.push(`Paragraph ${i + 1}: **bold** appears outside <u>…</u>. Every bold must sit inside an underline.`);
    }

    if (sourceParas.length) {
      const norm = normalizeForMatch(p);
      if (!norm) continue;
      const exact = sourceParas.includes(norm);
      if (!exact) {
        const contained = sourceJoined.includes(norm);
        if (!contained) {
          issues.push(
            `Paragraph ${i + 1}: NOT VERBATIM or paragraph was split/shortened. Every output paragraph must be a WHOLE source paragraph copied word-for-word (no deletions in the middle, no joined fragments from different paragraphs). Preview: "${stripMarks(p).slice(0, 120)}…"`
          );
        } else {
          issues.push(
            `Paragraph ${i + 1}: paragraph appears trimmed — output is a substring of source, not a whole source paragraph. Include the ENTIRE source paragraph from first to last word. Preview: "${stripMarks(p).slice(0, 120)}…"`
          );
        }
      }
    }
  }

  return {
    ok: issues.length === 0,
    critique: issues.join('\n'),
    issues,
  };
}

module.exports = { validateCut };
