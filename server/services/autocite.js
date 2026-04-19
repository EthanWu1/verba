'use strict';

const { complete } = require('./llm');
const crossref = require('./cite/crossref');
const citoid = require('./cite/citoid');

async function buildCite(meta, { inferQuals = true } = {}) {
  let title  = String(meta.title || '').trim();
  let author = cleanAuthor(meta.author);
  let date   = String(meta.date || '').trim();
  let source = String(meta.source || '').trim();
  const url  = String(meta.url || '').trim();
  const explicitDoi = String(meta.doi || '').trim();

  // Third-party fill: only fetch if something is missing.
  if ((!author || !date) && (url || explicitDoi)) {
    const doiFromUrl = url.match(/doi\.org\/(10\.\d+\/[^\s?#]+)/i)?.[1];
    const doiFromTitle = title.match(/10\.\d+\/[^\s?#]+/)?.[0];
    const doi = explicitDoi || doiFromUrl || doiFromTitle;
    const thirdParty =
      (doi ? await crossref.resolve({ doi }) : null)
      || await citoid.resolve(url)
      || (title ? await crossref.resolve({ title }) : null);
    if (thirdParty) {
      if (!author && thirdParty.author) author = cleanAuthor(thirdParty.author);
      if (!date && thirdParty.date) date = thirdParty.date;
      if (!title && thirdParty.title) title = thirdParty.title;
      if (!source && thirdParty.source) source = thirdParty.source;
    }
  }

  const lastName = parseLastName(author);
  const year = parseYear(date);
  const hasAuthor = Boolean(lastName);
  const hasYear = Boolean(year);

  let quals = '';
  if (inferQuals && hasAuthor) {
    quals = await inferCredentials(author, title, source);
  }

  const bibParts = [
    author,
    quals,
    title ? `"${title}"` : '',
    source,
    formatDate(date),
    url,
  ].filter(Boolean);

  const shortCite = hasAuthor
    ? (hasYear ? `${lastName} '${year}` : lastName)
    : '[No Author]';

  const fullBibliog = bibParts.join('; ');
  const citeString = fullBibliog ? `${shortCite} [${fullBibliog}]` : shortCite;

  return {
    citeString,
    lastYY: shortCite,
    lastName: lastName || '',
    year: year || '',
    fullBibliog,
    quals,
    hasAuthor,
    hasYear,
    missing: [
      !hasAuthor && 'author',
      !hasYear && 'date',
      !title && 'title',
      !source && 'source',
      !url && 'url',
    ].filter(Boolean),
  };
}

function cleanAuthor(raw) {
  if (!raw) return '';
  const clean = String(raw)
    .replace(/^(by|written by|author[:\s])\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(staff|editor|editorial team|admin)$/i.test(clean)) return '';
  return clean;
}

function parseLastName(author) {
  if (!author) return '';
  const clean = author.replace(/^(by|written by)\s+/i, '').trim();
  if (clean.includes(',')) return clean.split(',')[0].trim();
  const parts = clean.split(/\s+/);
  return parts[parts.length - 1] || '';
}

function parseYear(dateStr) {
  if (!dateStr) return '';
  const match = String(dateStr).match(/\b(20\d\d|19\d\d)\b/);
  return match ? match[1].slice(-2) : '';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
  } catch {}
  return dateStr;
}

async function inferCredentials(author, title, source) {
  try {
    const result = await complete({
      messages: [
        {
          role: 'system',
          content:
            'You are a debate research assistant. Given an author name, article title, and source publication, infer the author\'s likely professional credentials in one short phrase of at most 12 words. If nothing meaningful can be inferred, return an empty string. Return only the phrase. Do not guess an employer you are not confident about.',
        },
        {
          role: 'user',
          content: `Author: ${author}\nArticle: "${title}"\nSource: ${source}`,
        },
      ],
      maxTokens: 60,
      temperature: 0.1,
    });
    const creds = result.content.trim().replace(/^["']|["']$/g, '');
    if (creds && creds.length < 120 && !creds.includes('\n')) return creds;
  } catch {}
  return '';
}

function validateCiteMatchesMeta(cite, meta) {
  const url = String(meta.url || '').trim();
  if (!url || !cite) return true;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    // Ensure the URL (or at least the host) appears in the bracketed bibliographic section
    return cite.includes(url) || cite.includes(host);
  } catch {
    return true;
  }
}

module.exports = { buildCite, validateCiteMatchesMeta };
