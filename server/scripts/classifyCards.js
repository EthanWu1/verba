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

const BATCH_SIZE = 75;
const DELAY_MS   = 100;
const PRIMARY_MODEL  = 'google/gemini-2.5-flash-lite';
const FALLBACK_MODEL = 'openai/gpt-4o-mini';

const args = process.argv.slice(2);
const RECLASSIFY_ALL = args.includes('--all');
const LIMIT = (() => {
  const idx = args.indexOf('--limit');
  return idx !== -1 ? parseInt(args[idx + 1], 10) : Infinity;
})();

// Mirrors the parser's word-count rule (server/services/docxImport.js).
// Counts words inside <u>...</u>, **...**, or ==...== markers.
function countFormattedWords(markdown) {
  if (!markdown) return 0;
  const re = /<u>([\s\S]*?)<\/u>|\*\*([\s\S]*?)\*\*|==([\s\S]*?)==/g;
  let total = 0;
  let m;
  while ((m = re.exec(String(markdown))) !== null) {
    const inner = (m[1] || m[2] || m[3] || '').replace(/<[^>]+>|\*\*|==/g, '');
    total += inner.split(/\s+/).filter(Boolean).length;
  }
  return total;
}

// ── Prompt ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a competitive debate expert (LD, Policy, NDTCEDA).
Classify each card by its broad TYPE and specific TOPICS.

BROAD TYPE — pick exactly one of:
- policy   : policymaking args. plan solvency, disadvantages, counterplans, advantages, impact scenarios (deterrence, econ, heg, disease, war). If it argues consequences of a plan/action, it's policy.
- k        : critical / kritik args. attacks reps, mindsets, assumptions, ontology, epistemology, subject formation, root-cause critiques (cap, settler col, antiblackness, psychoanalysis, biopower, heidegger, etc).
- phil     : ETHICAL FRAMEWORK ONLY — argues for or against a moral theory itself (util, kant, rawls, virtue ethics, contractualism, deontology, moral realism, metaethics, naming a philosopher as the framework). NOT real-world impacts, NOT war/extinction, NOT settler colonialism, NOT capitalism analysis. If the card discusses a political/material/social problem (even in moral language), it is policy or k, NOT phil. Phil tags must reference a philosopher or moral theory by name.
- theory   : PROCEDURAL DEBATE THEORY ONLY — arguments about HOW the debate should be conducted, not about the topic. Topicality/definitions, fairness, education, condo, PICs, dispo, competing interps, reasonability, standards, violations, voters, RVI, disclosure, spec, CP theory, new affs bad, etc. NOT framework-first. NOT "X comes first in any framework" — that's phil. NOT impact framing — that's policy or phil.
- tricks   : SPECIFIC trick arguments only — name the trick. Examples: permissibility, presumption, skep, a priori, truth testing, analytic truths, contraposition, infinite regress, error theory, grain paradox, evaluate the debate after the 1AC, monism, indexicals, NIBs, calc indeterminacy. NEVER use "philosophy" as a tricks topic — that's too generic. If you can't name the specific trick, it's probably phil or none.
- none     : unclear or card is just an author bio / section header.

TOPICS — pick any number of short, specific labels for what the card is ABOUT. Use lowercase. Examples:
  deterrence, escalation, miscalc, china, russia, nfu, prolif, arms control, heg, econ, trade,
  climate, ai, cyber, immigration, terrorism, disease, warming, grid,
  politics, elections, agenda, midterms, congress, biden, trump, capital,
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
- If a card argues against settlers / for indigenous sovereignty / decolonization / rewilding through indigenous lens, type=k, topic includes settler colonialism.
- A REAL WORLD WAR/WEAPONS card (REM, escalation, deterrence, prolif, china, russia, nfu, arms control) is type=policy, NEVER type=phil — even if the tag mentions ethics/morality.
- If a card defends a NAMED moral theory or philosopher (util, kant, rawls, contractualism, etc.) as framework, type=phil, topic includes that theory.
- "X comes first in any framework" / "X precedes/outweighs other frameworks" / value-criterion arguments / framework-first claims = type=phil (NOT theory). Theory is ONLY procedural (T, condo, disclosure, dispo, PICs, etc.).
- If a card says "condo bad", type=theory, topic=condo.
- If a card says CP solves plus net benefit, type=policy.
- Politics DAs (elections, midterms, agenda, congress, biden, trump, polls, capital) → topics: "politics", "elections" (whichever fits). NEVER use "general ld" or any "general *" label.
- FORBIDDEN topic strings: "general ld", "general policy", "general k", "general", "misc", "various", "evidence", "card". Pick something specific or return empty topics.
- Do NOT tag aff/neg.
- Empty/unclear → type=none, topics=[].

OUTPUT: JSON array, one object per card, in order:
[{"type":"policy","topics":["deterrence","china"]}, {"type":"k","topics":["capitalism","subject formation"]}]

No markdown. No explanation. Raw JSON only.`;

// ── Classify one batch ────────────────────────────────────────────────────

function buildCardBlob(card) {
  const tag = String(card.tag || '').slice(0, 120);
  const cite = String(card.shortCite || card.cite || '').slice(0, 60);
  const body = String(card.body_plain || '').replace(/\s+/g, ' ').slice(0, 200);
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
      maxTokens: 4096,
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
const FORBIDDEN_TOPICS = new Set([
  'general ld', 'general policy', 'general k', 'general phil', 'general theory',
  'general', 'misc', 'various', 'evidence', 'card', 'unknown', 'n/a', 'none',
  // 'philosophy' is too generic — name the specific theory (util/kant/etc.)
  // or the specific trick (permissibility/skep/grain paradox/etc.) instead.
  'philosophy', 'framework', 'ethics', 'moral theory',
  'theory', 'argument', 'debate',
]);

function saveResult(id, result, sourceRow) {
  const rawType = String(result?.type || 'none').toLowerCase().trim();
  const type = VALID_TYPES.has(rawType) ? rawType : 'none';
  const topics = Array.isArray(result?.topics)
    ? result.topics
        .map(t => String(t || '').toLowerCase().trim())
        .filter(Boolean)
        .filter(t => !FORBIDDEN_TOPICS.has(t) && !t.startsWith('general '))
        .slice(0, 8)
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
  const FORMATTED_ONLY = args.includes('--formatted');
  const FULLCITE_ONLY  = args.includes('--fullcite');
  const whereCanon = CANONICAL_ONLY ? ' AND isCanonical=1' : '';
  // --fullcite: cite must be meaningfully longer than shortCite (not just
  // "Author 'YY"). Matches the bucketing used elsewhere in the codebase.
  const whereCite = FULLCITE_ONLY
    ? ' AND length(cite) > length(shortCite) + 5'
    : '';
  // --formatted: SQL preselect requires SOME formatting marker in body.
  // The strict "≥5 formatted words" rule is enforced in JS post-filter below
  // because counting words inside <u>...</u>/==...== reliably needs regex.
  const whereFmt = FORMATTED_ONLY
    ? " AND (body_markdown LIKE '%<u>%' OR body_markdown LIKE '%==%')"
    : '';
  const selectCols = 'id, tag, shortCite, cite, body_plain, body_markdown, sourceKind, division, zipPath, topicBucket';
  const query = RECLASSIFY_ALL
    ? `SELECT ${selectCols} FROM cards WHERE 1=1${whereCanon}${whereFmt}${whereCite} ORDER BY importedAt DESC`
    : `SELECT ${selectCols} FROM cards
       WHERE (argumentTags IN ('[]', '["none"]')
          OR argumentTypes IN ('[]', '["none"]'))${whereCanon}${whereFmt}${whereCite}
       ORDER BY importedAt DESC`;

  // Stream + process in batches, never accumulating the full card set in memory.
  // The previous approach loaded all 154k+ matching rows (~770MB) before
  // classifying — OOMed Node's default ~960MB heap on tight-RAM hosts.
  const stmt = database.prepare(query);
  let scanned = 0, skippedFmt = 0, done = 0, failed = 0, batchNum = 0;
  let buffer = [];
  let stopReading = false;

  const processBatch = async (batch) => {
    batchNum++;
    let results = await classifyBatch(batch, PRIMARY_MODEL);
    if (!results) results = await classifyBatch(batch, FALLBACK_MODEL);
    if (results) {
      for (let j = 0; j < batch.length; j++) {
        saveResult(batch[j].id, results[j], batch[j]);
      }
      done += batch.length;
    } else {
      failed += batch.length;
    }
    if (batchNum % 10 === 0) {
      console.log(`[classify] batch ${batchNum} | scanned ${scanned}, ${done} tagged, ${failed} failed, ${skippedFmt} skipped (<5 fmt words)`);
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  };

  for (const row of stmt.iterate()) {
    scanned++;
    if (FORMATTED_ONLY && countFormattedWords(row.body_markdown) < 5) {
      skippedFmt++;
      continue;
    }
    buffer.push(row);
    if (Number.isFinite(LIMIT) && (done + buffer.length) >= LIMIT) {
      stopReading = true;
    }
    if (buffer.length >= BATCH_SIZE) {
      await processBatch(buffer);
      buffer = [];
      if (stopReading) break;
    }
  }
  if (buffer.length > 0) await processBatch(buffer);

  console.log(`[classify] Primary done. ${done} tagged, ${failed} failed.`);

  // Re-pass: query DB for cards classified as 'none' instead of holding them
  // in memory. argumentTypes='["none"]' is the marker.
  const reQuery = `SELECT ${selectCols} FROM cards
    WHERE argumentTypes = '["none"]'${whereCanon}${whereFmt}${whereCite}
    ORDER BY importedAt DESC`;
  const reStmt = database.prepare(reQuery);
  let rescued = 0;
  let reBuf = [];
  let reCount = 0;

  const reProcess = async (batch) => {
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
    await new Promise(r => setTimeout(r, DELAY_MS));
  };

  for (const row of reStmt.iterate()) {
    reCount++;
    if (FORMATTED_ONLY && countFormattedWords(row.body_markdown) < 5) continue;
    reBuf.push(row);
    if (reBuf.length >= BATCH_SIZE) {
      await reProcess(reBuf);
      reBuf = [];
    }
  }
  if (reBuf.length > 0) await reProcess(reBuf);
  if (reCount > 0) console.log(`[classify] Re-pass scanned ${reCount}, ${rescued} rescued from 'none'.`);
}

main().catch(err => {
  console.error('[classify] Fatal:', err.message);
  process.exit(1);
});
