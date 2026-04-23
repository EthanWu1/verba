'use strict';

/**
 * Post-ingestion LLM classifier.
 * Produces a broad argument TYPE (policy|k|phil|theory|tricks|none)
 * and a list of specific TOPICS (deterrence, capitalism, fairness, etc.).
 *
 * Writes:
 *   cards.argumentTypes = '["policy"]'   (array of one — broad type)
 *   cards.argumentTags  = '["deterrence","china"]'  (topic tags)
 *
 * Usage:
 *   node server/scripts/classifyCards.js           # classify all untagged
 *   node server/scripts/classifyCards.js --all     # reclassify everything
 *   node server/scripts/classifyCards.js --limit 500
 */

require('dotenv').config();
const db = require('../services/db');
const { deriveAllLabels } = require('../services/labelDerivation');
const { complete, parseJSON } = require('../services/llm');

const BATCH_SIZE = 25;
const DELAY_MS   = 400;
const PRIMARY_MODEL  = 'google/gemini-2.5-flash-lite';
const FALLBACK_MODEL = 'openai/gpt-4o-mini';

const args = process.argv.slice(2);
const RECLASSIFY_ALL = args.includes('--all');
const LIMIT = (() => {
  const idx = args.indexOf('--limit');
  return idx !== -1 ? parseInt(args[idx + 1], 10) : Infinity;
})();

// ── Prompt ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a competitive debate expert (LD, Policy, NDTCEDA).
Classify each card by its broad TYPE and specific TOPICS.

BROAD TYPE — pick exactly one of:
- policy   : policymaking args. plan solvency, disadvantages, counterplans, advantages, impact scenarios (deterrence, econ, heg, disease, war). If it argues consequences of a plan/action, it's policy.
- k        : critical / kritik args. attacks reps, mindsets, assumptions, ontology, epistemology, subject formation, root-cause critiques (cap, settler col, antiblackness, psychoanalysis, biopower, heidegger, etc).
- phil     : ethical/philosophical framework. util, kant, rawls, virtue ethics, contractualism, deontology, moral realism, metaethics.
- theory   : procedural debate theory. definitions/topicality, fairness, education, condo, pics, dispo, competing interps, reasonability, standards, violations, voters, RVI, disclosure, spec, CP theory.
- tricks   : a priori / skep / weird paradoxes / framing spikes. truth testing, permissibility, presumption, infinite regress, analytic truths, contraposition, skep triggers, burden spikes.
- none     : unclear or card is just an author bio / section header.

TOPICS — pick any number of short, specific labels for what the card is ABOUT. Use lowercase. Examples:
  deterrence, escalation, miscalc, china, russia, nfu, prolif, arms control, heg, econ, trade,
  climate, ai, cyber, immigration, terrorism, disease, warming, grid,
  capitalism, settler colonialism, antiblackness, afropessimism, feminism, queer theory, psychoanalysis,
  heidegger, nietzsche, foucault, biopower, security critique, militarism, orientalism, ableism,
  subject formation, ontology, epistemology, decolonization, indigenous, whiteness,
  util, kant, rawls, virtue ethics, contractualism, deontology, moral realism, metaethics, rights,
  fairness, education, condo, topicality, pics, dispo, rvi, disclosure, spec, reasonability,
  competing interps, process cp theory, consult cp theory, delay cp theory, multi-actor fiat,
  skep, a priori, presumption, permissibility, truth testing, infinite regress, error theory.

RULES:
- Be SPECIFIC on topics. "nuclear war" is too broad — say "deterrence" or "escalation" or "miscalc".
- Do NOT use topics like "nuclear war" or "extinction" alone — those are impacts, find the cause.
- If a card says capitalism causes X, type=k, topic includes capitalism.
- If a card defends util framework, type=phil, topic=util.
- If a card says "condo bad", type=theory, topic=condo.
- If a card says CP solves plus net benefit, type=policy.
- Do NOT tag aff/neg.
- Empty/unclear → type=none, topics=[].

OUTPUT: JSON array, one object per card, in order:
[{"type":"policy","topics":["deterrence","china"]}, {"type":"k","topics":["capitalism","subject formation"]}]

No markdown. No explanation. Raw JSON only.`;

// ── Classify one batch ────────────────────────────────────────────────────

function buildCardBlob(card) {
  const tag = String(card.tag || '').slice(0, 160);
  const cite = String(card.shortCite || card.cite || '').slice(0, 80);
  const body = String(card.body_plain || '').replace(/\s+/g, ' ').slice(0, 250);
  return `TAG: ${tag}\nCITE: ${cite}\nBODY: ${body}`;
}

async function classifyBatch(cards, model = PRIMARY_MODEL) {
  const blobs = cards.map((c, i) => `=== CARD ${i + 1} ===\n${buildCardBlob(c)}`).join('\n\n');

  try {
    const { content } = await complete({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: blobs },
      ],
      temperature: 0.1,
      maxTokens: 2048,
      forceModel: model,
    });

    const parsed = parseJSON(content);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.warn(`[classify] Bad response from ${model}: got ${parsed?.length}, expected ${cards.length}`);
      return null;
    }
    while (parsed.length < cards.length) parsed.push({ type: 'none', topics: [] });
    return parsed.slice(0, cards.length);
  } catch (err) {
    console.error(`[classify] LLM error (${model}): ${err.message}`);
    return null;
  }
}

// ── Update DB ─────────────────────────────────────────────────────────────

const VALID_TYPES = new Set(['policy', 'k', 'phil', 'theory', 'tricks', 'none']);

function saveResult(id, result, sourceRow) {
  const rawType = String(result?.type || 'none').toLowerCase().trim();
  const type = VALID_TYPES.has(rawType) ? rawType : 'none';
  const topics = Array.isArray(result?.topics)
    ? result.topics.map(t => String(t || '').toLowerCase().trim()).filter(Boolean).slice(0, 8)
    : [];
  const labels = deriveAllLabels({
    argumentTypes: [type],
    argumentTags: topics,
    sourceKind: sourceRow?.sourceKind,
    division: sourceRow?.division,
    zipPath: sourceRow?.zipPath,
    topicBucket: sourceRow?.topicBucket,
  });
  db.getDb()
    .prepare('UPDATE cards SET argumentTypes = ?, argumentTags = ?, typeLabel = ?, topicLabel = ? WHERE id = ?')
    .run(JSON.stringify([type]), JSON.stringify(topics), labels.typeLabel, labels.topicLabel, id);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const database = db.getDb();

  const CANONICAL_ONLY = args.includes('--canonical');
  const whereCanon = CANONICAL_ONLY ? ' AND isCanonical=1' : '';
  const query = RECLASSIFY_ALL
    ? `SELECT id, tag, shortCite, cite, body_plain, sourceKind, division, zipPath, topicBucket FROM cards WHERE 1=1${whereCanon} ORDER BY importedAt DESC`
    : `SELECT id, tag, shortCite, cite, body_plain, sourceKind, division, zipPath, topicBucket FROM cards
       WHERE (argumentTags IN ('[]', '["none"]')
          OR argumentTypes IN ('[]', '["none"]'))${whereCanon}
       ORDER BY importedAt DESC`;

  let cards = database.prepare(query).all();
  if (Number.isFinite(LIMIT)) cards = cards.slice(0, LIMIT);

  const total = cards.length;
  console.log(`[classify] ${total} cards to classify (batch=${BATCH_SIZE})`);

  let done = 0;
  let failed = 0;
  const noneCards = [];

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = cards.slice(i, i + BATCH_SIZE);
    let results = await classifyBatch(batch, PRIMARY_MODEL);

    if (!results) {
      results = await classifyBatch(batch, FALLBACK_MODEL);
    }

    if (results) {
      for (let j = 0; j < batch.length; j++) {
        const r = results[j];
        saveResult(batch[j].id, r, batch[j]);
        const rawType = String(r?.type || 'none').toLowerCase().trim();
        if (rawType === 'none') noneCards.push(batch[j]);
      }
      done += batch.length;
    } else {
      failed += batch.length;
    }

    if ((i / BATCH_SIZE) % 10 === 0 || i + BATCH_SIZE >= total) {
      console.log(`[classify] ${done + failed}/${total} — ${done} tagged, ${failed} failed, ${noneCards.length} queued for re-pass`);
    }

    if (i + BATCH_SIZE < total) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`[classify] Primary done. ${done} tagged, ${failed} failed.`);

  if (noneCards.length) {
    console.log(`[classify] Re-pass ${noneCards.length} 'none' cards via ${FALLBACK_MODEL}`);
    let rescued = 0;
    for (let i = 0; i < noneCards.length; i += BATCH_SIZE) {
      const batch = noneCards.slice(i, i + BATCH_SIZE);
      const results = await classifyBatch(batch, FALLBACK_MODEL);
      if (results) {
        for (let j = 0; j < batch.length; j++) {
          const rawType = String(results[j]?.type || 'none').toLowerCase().trim();
          if (rawType !== 'none') {
            saveResult(batch[j].id, results[j], batch[j]);
            rescued++;
          }
        }
      }
      if ((i / BATCH_SIZE) % 10 === 0 || i + BATCH_SIZE >= noneCards.length) {
        console.log(`[classify] Re-pass ${Math.min(i + BATCH_SIZE, noneCards.length)}/${noneCards.length} — ${rescued} rescued`);
      }
      if (i + BATCH_SIZE < noneCards.length) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }
    console.log(`[classify] Re-pass done. ${rescued} rescued from 'none'.`);
  }
}

main().catch(err => {
  console.error('[classify] Fatal:', err.message);
  process.exit(1);
});
