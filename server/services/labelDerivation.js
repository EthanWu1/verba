'use strict';

const TYPE_DISPLAY = {
  policy: 'Policy',
  k:      'K',
  phil:   'Phil',
  theory: 'Theory',
  tricks: 'Tricks',
  none:   '',
};

const TOPIC_ACRONYMS = new Set([
  'ai', 'cp', 'da', 'nfu', 'rvi', 'pic', 'pics',
  'us', 'uk', 'eu', 'un', 'nato', 'ndt', 'ceda', 'ld',
  'icj', 'icc', 'wto', 'imf',
]);

function titleCaseTopic(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(word => {
      const lower = word.toLowerCase();
      if (TOPIC_ACRONYMS.has(lower)) return lower.toUpperCase();
      return lower.replace(/\b\w/g, c => c.toUpperCase());
    })
    .join(' ');
}

function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try { const p = JSON.parse(value || '[]'); return Array.isArray(p) ? p : []; }
  catch { return []; }
}

function deriveTypeLabel(card) {
  const types = parseJsonArray(card.argumentTypes);
  const first = String(types[0] || '').toLowerCase().trim();
  return TYPE_DISPLAY[first] || '';
}

function deriveTopicLabel(card) {
  const tags = parseJsonArray(card.argumentTags);
  const first = String(tags[0] || '').trim();
  if (first) return titleCaseTopic(first);
  return String(card.topicBucket || '').trim() || 'General LD';
}

function deriveSourceLabel(card) {
  return card.sourceKind === 'personal' ? 'My Cards' : 'Public Community Cards';
}

function deriveScope(card) {
  return card.sourceKind === 'personal' ? 'my' : 'public';
}

function deriveResolutionLabel(card) {
  if (card.resolution) return card.resolution;
  const division = String(card.division || '').toLowerCase();
  const zipPath = String(card.zipPath || '').toLowerCase();
  const source = `${division} ${zipPath}`;

  const hsLd = source.match(/hsld(\d{2})/);
  if (hsLd) {
    const year = Number(hsLd[1]);
    return `HS LD 20${hsLd[1]}-${String(year + 1).padStart(2, '0')}`;
  }

  const policy = source.match(/(ndtceda|hspolicy)(\d{2})/);
  if (policy) {
    const year = Number(policy[2]);
    const label = policy[1] === 'ndtceda' ? 'NDT/CEDA' : 'HS Policy';
    return `${label} 20${policy[2]}-${String(year + 1).padStart(2, '0')}`;
  }

  return division ? titleCase(division) : 'General';
}

function deriveAllLabels(card) {
  return {
    typeLabel:       deriveTypeLabel(card),
    topicLabel:      deriveTopicLabel(card),
    sourceLabel:     deriveSourceLabel(card),
    scope:           deriveScope(card),
    resolutionLabel: deriveResolutionLabel(card),
  };
}

module.exports = {
  TYPE_DISPLAY,
  titleCaseTopic,
  titleCase,
  deriveTypeLabel,
  deriveTopicLabel,
  deriveSourceLabel,
  deriveScope,
  deriveResolutionLabel,
  deriveAllLabels,
};
