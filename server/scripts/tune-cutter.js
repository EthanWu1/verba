'use strict';

/**
 * tune-cutter.js — iterative tuning harness.
 *
 * Reads a gold-standard hand-cut markdown file, strips its markup to recover
 * plain source text, sends it through cutCardV2 with the gold tag as the
 * argument, and writes a side-by-side comparison file plus a quality report.
 *
 * Usage:
 *   node server/scripts/tune-cutter.js tmp/gold-cuts/card-1/01-...md tmp/iterations/00-baseline/card-1
 *
 * The output dir gets:
 *   - source.txt       plain article body (input to cutter)
 *   - argument.txt     gold tag (used as DEBATER INTENT)
 *   - gold.md          gold-standard markdown for visual comparison
 *   - machine.md       machine-cut markdown (the result)
 *   - report.md        densities, bolds, chain coverage, fragmentation
 */

// override:true so any blank shell-level ANTHROPIC_API_KEY doesn't shadow .env
require('dotenv').config({ override: true });

const fs = require('fs');
const path = require('path');

const { cutCardV2, clearCache } = require('../services/cutCardV2');
const { chainArgumentScore, extractReadAloudChain } = require('../services/cardReconstructor');

// ── strip markup helpers ─────────────────────────────────────────────

function stripMarkup(md) {
  return String(md || '')
    // **<u>...</u>**, ==<u>...</u>==, etc — remove the wrappers, keep inner.
    .replace(/==/g, '')
    .replace(/\*\*/g, '')
    .replace(/<\/?u>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*\n+/g, '\n\n')
    .trim();
}

function parseGoldFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  // Heading line "# tag"
  const tagMatch = raw.match(/^#\s+(.+?)$/m);
  const tag = tagMatch ? tagMatch[1].trim() : '';
  // Cite line "**Cite:** ..."
  const citeMatch = raw.match(/^\*\*Cite:\*\*\s+(.+?)$/m);
  const cite = citeMatch ? stripMarkup(citeMatch[1]).trim() : '';
  // Body = everything after the cite line, with markup intact.
  const lines = raw.split(/\r?\n/);
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\*\*Cite:\*\*/.test(lines[i])) { bodyStart = i + 1; break; }
    if (/^#\s+/.test(lines[i])) bodyStart = i + 1;
  }
  const body = lines.slice(bodyStart).join('\n').trim();
  const plainBody = stripMarkup(body);
  return { tag, cite, body, plainBody };
}

// ── markup-stat helpers (rough) ──────────────────────────────────────

function countMarkup(md) {
  const stripped = stripMarkup(md);
  const hChars = (md.match(/==[\s\S]*?==/g) || []).reduce((a, m) => a + stripMarkup(m).length, 0);
  const uChars = (md.match(/<u>[\s\S]*?<\/u>/g) || []).reduce((a, m) => a + stripMarkup(m).length, 0);
  const bChars = (md.match(/\*\*[\s\S]*?\*\*/g) || []).reduce((a, m) => a + stripMarkup(m).length, 0);
  const total = stripped.length;
  return {
    totalChars: total,
    highlightChars: hChars,
    underlineChars: uChars,
    boldChars: bChars,
    highlightPct: total ? hChars / total : 0,
    underlinePct: total ? uChars / total : 0,
    boldPct:      total ? bChars / total : 0,
    boldCount:    (md.match(/\*\*[\s\S]*?\*\*/g) || []).length,
    highlightCount: (md.match(/==[\s\S]*?==/g) || []).length,
  };
}

// Approx average words per highlight phrase.
function avgWordsPerHighlight(md) {
  const m = md.match(/==([\s\S]*?)==/g) || [];
  if (!m.length) return 0;
  const total = m.reduce((a, h) => a + stripMarkup(h).split(/\s+/).filter(Boolean).length, 0);
  return total / m.length;
}

// ── main ────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2) {
    console.error('Usage: node server/scripts/tune-cutter.js <gold.md> <out-dir>');
    process.exit(2);
  }
  const goldPath = path.resolve(argv[0]);
  const outDir = path.resolve(argv[1]);
  fs.mkdirSync(outDir, { recursive: true });

  const { tag, cite, body: goldBody, plainBody } = parseGoldFile(goldPath);
  if (!plainBody || plainBody.length < 200) {
    console.error(`Gold body too short: ${plainBody.length} chars. Aborting.`);
    process.exit(1);
  }

  fs.writeFileSync(path.join(outDir, 'source.txt'), plainBody);
  fs.writeFileSync(path.join(outDir, 'argument.txt'), tag);
  fs.writeFileSync(path.join(outDir, 'gold.md'), goldBody);

  // Intercept the LLM's raw picks JSON for debugging.
  const llm = require('../services/llm');
  const realCompleteJSON = llm.completeJSON.bind(llm);
  let rawPicks = null;
  llm.completeJSON = async (...args) => {
    const r = await realCompleteJSON(...args);
    rawPicks = r.json;
    return r;
  };

  console.log(`gold tag:      ${tag.slice(0, 100)}`);
  console.log(`gold cite:     ${cite.slice(0, 80)}`);
  console.log(`source chars:  ${plainBody.length}`);
  console.log('cutting...');

  clearCache();
  const t0 = Date.now();
  const result = await cutCardV2({
    argument: tag,
    bodyText: plainBody,
    cite,
    density: 'heavy',
    length: 'long',
    primaryModel: process.env.CARD_CUT_MODEL || 'claude-haiku-4-5',
    // For tuning: skip Sonnet retry path so we measure HAIKU-only quality.
    fallbackModel: null,
    useCache: false,
  });
  const elapsed = Date.now() - t0;

  const machineMd = result.card.body_markdown;
  fs.writeFileSync(path.join(outDir, 'machine.md'), machineMd);
  if (rawPicks) {
    fs.writeFileSync(path.join(outDir, 'raw-picks.json'), JSON.stringify(rawPicks, null, 2));
    // Also dump the actual highlight TEXT for each pick so we can see what the
    // model intended (before merging/snapping/reconstruction).
    const candidates = result.candidates || [];
    const candById = new Map(candidates.map(c => [c.index, c.text]));
    const lines = [];
    lines.push(`# Raw model picks for ${path.basename(goldPath)}`);
    lines.push(`Argument: ${rawPicks.argument || '(none)'}`);
    lines.push('');
    for (const pick of (rawPicks.picks || [])) {
      const text = candById.get(pick.p) || '';
      lines.push(`## p${pick.p} (paragraph length ${text.length})`);
      lines.push('');
      const labels = ['u', 'h', 'b'];
      for (const k of labels) {
        const items = pick[k] || [];
        lines.push(`**${k}** (${items.length}):`);
        for (const it of items) {
          if (typeof it === 'string') {
            lines.push(`  "${it.replace(/\n/g, ' ')}"`);
          } else if (Array.isArray(it) && it.length === 2 && typeof it[0] === 'number') {
            const [a, b] = it;
            const slice = text.slice(a, b).replace(/\n/g, ' ');
            lines.push(`  [${a},${b}) ${b - a}ch "${slice}"`);
          } else {
            lines.push(`  ${JSON.stringify(it)}`);
          }
        }
        lines.push('');
      }
    }
    fs.writeFileSync(path.join(outDir, 'raw-picks.md'), lines.join('\n'));
  }

  const goldStats = countMarkup(goldBody);
  const machStats = countMarkup(machineMd);
  const goldAvg = avgWordsPerHighlight(goldBody);
  const machAvg = avgWordsPerHighlight(machineMd);

  // Re-extract chain stats post-reconstruction.
  const chain = extractReadAloudChain(result?.candidates ? { picks: [] } : {}, []);  // placeholder
  // The chain stats are already in result.stats / result via the cutCardV2 log;
  // here we recompute against the gold tag for the tuning report.
  const chainText = result.card.readAloudChain || '';
  const score = chainArgumentScore(tag, chainText);

  const pct = (n) => `${(n * 100).toFixed(1)}%`;

  const report = `# Tuning report — ${path.basename(goldPath)}

**Source chars:** ${plainBody.length}
**Argument:** "${tag}"
**Cite:** "${cite}"
**Model:** ${result.model}
**Elapsed:** ${elapsed}ms
**Cached:** ${result.cached}

## Density (gold vs machine)

|             | Gold        | Machine     | Δ |
|-------------|-------------|-------------|---|
| Highlight % | ${pct(goldStats.highlightPct)} | ${pct(machStats.highlightPct)} | ${pct(machStats.highlightPct - goldStats.highlightPct)} |
| Underline % | ${pct(goldStats.underlinePct)} | ${pct(machStats.underlinePct)} | ${pct(machStats.underlinePct - goldStats.underlinePct)} |
| Bold %      | ${pct(goldStats.boldPct)}      | ${pct(machStats.boldPct)}      | ${pct(machStats.boldPct - goldStats.boldPct)} |
| # Highlights | ${goldStats.highlightCount} | ${machStats.highlightCount} | ${machStats.highlightCount - goldStats.highlightCount} |
| # Bolds     | ${goldStats.boldCount}     | ${machStats.boldCount}      | ${machStats.boldCount - goldStats.boldCount} |
| Avg words/highlight | ${goldAvg.toFixed(2)} | ${machAvg.toFixed(2)} | ${(machAvg - goldAvg).toFixed(2)} |

## Chain validation (machine vs argument)

- Coverage: ${pct(score.coverage)} ${score.coverage >= 0.55 ? '✓' : '✗'}
- Bloat:    ${pct(score.bloat)}    ${score.bloat <= 0.40 ? '✓' : '✗'}
- Filler:   ${score.filler}        ${score.filler === 0 ? '✓' : '✗'}
- Danglers: ${score.danglers}/${score.phraseCount}
- Avg words/phrase: ${(score.avgWordsPerPhrase || 0).toFixed(2)} ${(score.avgWordsPerPhrase || 0) >= 3.0 ? '✓' : '✗'}

## Token usage

\`\`\`
${JSON.stringify(result.usage, null, 2)}
\`\`\`

## Files in this iteration

- source.txt   — plain source (input to cutter)
- argument.txt — DEBATER INTENT (gold tag)
- gold.md      — hand-cut markdown
- machine.md   — model-cut markdown
- report.md    — this file
`;

  fs.writeFileSync(path.join(outDir, 'report.md'), report);

  console.log(`\nDONE. ${elapsed}ms. ${result.model}.`);
  console.log(`Highlight % gold=${pct(goldStats.highlightPct)} machine=${pct(machStats.highlightPct)}`);
  console.log(`Bold %      gold=${pct(goldStats.boldPct)}      machine=${pct(machStats.boldPct)}`);
  console.log(`Avg words/H gold=${goldAvg.toFixed(2)} machine=${machAvg.toFixed(2)}`);
  console.log(`Chain: coverage=${pct(score.coverage)} bloat=${pct(score.bloat)} filler=${score.filler} avgw=${(score.avgWordsPerPhrase||0).toFixed(2)}`);
  console.log(`Out: ${outDir}`);
}

main().catch(err => { console.error(err); process.exit(1); });
