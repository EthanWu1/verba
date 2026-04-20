'use strict';

const { randomUUID } = require('crypto');
const { getDb } = require('./db');
const { complete, parseJSON } = require('./llm');
const { deriveAllLabels } = require('./labelDerivation');

const CLASSIFY_PRIMARY  = 'google/gemini-2.0-flash-lite-001';
const CLASSIFY_FALLBACK = 'openai/gpt-4o-mini';

const CLASSIFY_SYSTEM = `You are a competitive debate expert (LD, Policy, NDTCEDA).
Classify one card by its broad TYPE and specific TOPICS.

BROAD TYPE — pick exactly one of:
- policy   : policymaking args. plan solvency, disadvantages, counterplans, advantages, impact scenarios (deterrence, econ, heg, disease, war).
- k        : critical / kritik args. attacks reps, assumptions, ontology, subject formation, root-cause critiques (cap, settler col, antiblackness, etc).
- phil     : ethical/philosophical framework. util, kant, rawls, virtue ethics, contractualism, deontology, metaethics.
- theory   : procedural debate theory. topicality, fairness, condo, pics, dispo, competing interps, standards, RVI, disclosure, spec, CP theory.
- tricks   : a priori / skep / weird paradoxes. truth testing, permissibility, presumption, analytic truths, skep triggers.
- none     : unclear / bio / section header.

TOPICS — any number of short, specific lowercase labels. Be specific (use "deterrence" not "nuclear war").

OUTPUT: JSON only, no markdown. {"type":"policy","topics":["deterrence","china"]}`;

function cardBlob(card) {
  const tag = String(card.tag || '').slice(0, 160);
  const cite = String(card.shortCite || card.cite || '').slice(0, 120);
  const body = String(card.body_plain || card.body_markdown || '')
    .replace(/<\/?u>|==|\*\*|\u00B6/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 400);
  return `TAG: ${tag}\nCITE: ${cite}\nBODY: ${body}`;
}

const VALID_TYPES = new Set(['policy', 'k', 'phil', 'theory', 'tricks', 'none']);

async function classifyCutCard(card) {
  const user = cardBlob(card);
  async function once(model) {
    try {
      const { content } = await complete({
        messages: [
          { role: 'system', content: CLASSIFY_SYSTEM },
          { role: 'user', content: user },
        ],
        temperature: 0.1,
        maxTokens: 200,
        forceModel: model,
      });
      const parsed = parseJSON(content);
      if (parsed && typeof parsed === 'object') return parsed;
      return null;
    } catch {
      return null;
    }
  }
  const out = (await once(CLASSIFY_PRIMARY)) || (await once(CLASSIFY_FALLBACK));
  const rawType = String(out?.type || 'none').toLowerCase().trim();
  const type = VALID_TYPES.has(rawType) ? rawType : 'none';
  const topics = Array.isArray(out?.topics)
    ? out.topics.map(t => String(t || '').toLowerCase().trim()).filter(Boolean).slice(0, 8)
    : [];
  return { type, topics };
}

function stripFormatMarks(md) {
  return String(md || '')
    .replace(/\*\*<u>([\s\S]*?)<\/u>\*\*/g, '$1')
    .replace(/<u>([\s\S]*?)<\/u>/g, '$1')
    .replace(/==([\s\S]*?)==/g, '$1')
    .replace(/\u00B6/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fingerprint(c) {
  const t = String(c.tag || '').trim().toLowerCase();
  const ci = String(c.cite || c.shortCite || '').trim().toLowerCase();
  const b = String(c.body_plain || c.body_markdown || '').slice(0, 200).trim().toLowerCase();
  return t + '|' + ci + '|' + b;
}

async function saveCutCardForUser(userId, rawCard) {
  if (!userId || !rawCard) return null;
  const cls = await classifyCutCard(rawCard).catch(() => ({ type: 'none', topics: [] }));
  const labels = deriveAllLabels({
    argumentTypes: [cls.type],
    argumentTags: cls.topics,
    sourceKind: 'personal',
  });

  const enriched = {
    ...rawCard,
    body_plain: rawCard.body_plain || stripFormatMarks(rawCard.body_markdown || ''),
    argumentTypes: [cls.type],
    argumentTags: cls.topics,
    typeLabel: labels.typeLabel,
    topicLabel: labels.topicLabel,
    sourceLabel: labels.sourceLabel,
    scope: labels.scope,
    resolutionLabel: labels.resolutionLabel,
    sourceKind: 'personal',
  };

  const fp = fingerprint(enriched);
  const db = getDb();
  const existing = db.prepare('SELECT * FROM user_saved_cards WHERE userId = ? AND fingerprint = ?')
    .get(userId, fp);
  if (existing) {
    let payload = {};
    try { payload = JSON.parse(existing.payload); } catch {}
    return { card: { id: existing.id, ...payload, savedAt: existing.savedAt }, duplicate: true };
  }
  const id = enriched.id || randomUUID();
  const savedAt = new Date().toISOString();
  const toStore = { ...enriched, id };
  db.prepare('INSERT INTO user_saved_cards (id, userId, payload, fingerprint, savedAt) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, JSON.stringify(toStore), fp, savedAt);
  return { card: { ...toStore, savedAt }, duplicate: false };
}

module.exports = { classifyCutCard, saveCutCardForUser };
