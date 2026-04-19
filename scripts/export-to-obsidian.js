'use strict';

const fs = require('fs');
const path = require('path');

const { loadCards, loadMeta } = require('../server/services/libraryStore');
const { enrichCard } = require('../server/services/docxImport');

const OBSIDIAN_CONFIG_PATH = 'C:\\Users\\ethan\\AppData\\Roaming\\obsidian\\obsidian.json';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function slug(value, max = 80) {
  return String(value || 'untitled')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/\s+/g, ' ');
}

function yamlEscape(value) {
  return String(value || '').replace(/"/g, '\\"');
}

function readVaultPath() {
  const config = JSON.parse(fs.readFileSync(OBSIDIAN_CONFIG_PATH, 'utf8'));
  const openVault = Object.values(config.vaults || {}).find(v => v.open) || Object.values(config.vaults || {})[0];
  if (!openVault?.path) throw new Error('Could not determine Obsidian vault path.');
  return openVault.path;
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function buildFrontmatter(card) {
  return [
    '---',
    `short_cite: "${yamlEscape(card.shortCite || '')}"`,
    `full_cite: "${yamlEscape(card.cite || '')}"`,
    `school: "${yamlEscape(card.school || '')}"`,
    `squad: "${yamlEscape(card.squad || '')}"`,
    `topic: "${yamlEscape(card.topicBucket || '')}"`,
    `argument_type: "${yamlEscape(card.argumentType || '')}"`,
    `canonical: ${card.isCanonical ? 'true' : 'false'}`,
    `variant_count: ${Number(card.variantCount || 1)}`,
    `warrant_density: ${Number(card.warrantDensity || 0)}`,
    `source_kind: "${yamlEscape(card.sourceKind || '')}"`,
    `division: "${yamlEscape(card.division || '')}"`,
    `found_at: "${yamlEscape(card.foundAt || '')}"`,
    '---',
  ].join('\n');
}

function buildCardNote(card) {
  return `${buildFrontmatter(card)}

# ${card.tag || 'Untitled Card'}

## Cite
${card.cite || 'No cite available'}

## Card
${card.body_markdown || ''}

## Metadata
- School: ${card.school || 'Unknown'}
- Team: ${card.squad || 'Unknown'}
- Topic Bucket: ${card.topicBucket || 'General LD'}
- Argument Type: ${card.argumentType || 'Evidence Card'}
- Canonical: ${card.isCanonical ? 'Yes' : 'No'}
- Variants: ${card.variantCount || 1}
- Warrant Density: ${card.warrantDensity || 0}
- Source Entry: ${card.sourceEntry || ''}
`;
}

function countBy(cards, field) {
  const map = new Map();
  cards.forEach(card => {
    const key = card[field] || 'Unknown';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function groupBy(cards, field) {
  const map = new Map();
  cards.forEach(card => {
    const key = card[field] || 'Unknown';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(card);
  });
  return map;
}

function buildIndexNote(title, intro, groups) {
  const lines = [`# ${title}`, '', intro, ''];
  groups.forEach(([label, items]) => {
    lines.push(`## ${label}`);
    if (Array.isArray(items)) {
      items.slice(0, 200).forEach(item => {
        const noteName = `${slug(item.shortCite || 'No Cite', 30)} - ${slug(item.tag || 'Untitled', 80)}`;
        lines.push(`- [[Verbatim AI/Cards/${slug(item.topicBucket || 'General LD')}/${noteName}|${item.tag || noteName}]]`);
      });
    } else {
      lines.push(`- ${items}`);
    }
    lines.push('');
  });
  return lines.join('\n');
}

function exportToVault() {
  const vaultPath = readVaultPath();
  const baseDir = path.join(vaultPath, 'Verbatim AI');
  const cardsDir = path.join(baseDir, 'Cards');
  const analyticsDir = path.join(baseDir, 'Analytics');
  const dashboardsDir = path.join(baseDir, 'Dashboards');

  const cards = loadCards().map(enrichCard);
  const meta = loadMeta();

  ensureDir(cardsDir);
  ensureDir(analyticsDir);
  ensureDir(dashboardsDir);

  cards.forEach(card => {
    const topicDir = path.join(cardsDir, slug(card.topicBucket || 'General LD'));
    const fileName = `${slug(card.shortCite || 'No Cite', 30)} - ${slug(card.tag || 'Untitled', 100)}.md`;
    writeFile(path.join(topicDir, fileName), buildCardNote(card));
  });

  const topicGroups = groupBy(cards, 'topicBucket');
  const argumentGroups = groupBy(cards, 'argumentType');
  const schoolGroups = groupBy(cards, 'school');
  const citeGroups = groupBy(cards, 'shortCite');

  const topicCounts = countBy(cards, 'topicBucket').map(([label, count]) => [label, count]);
  const argumentCounts = countBy(cards, 'argumentType').map(([label, count]) => [label, count]);
  const schoolCounts = countBy(cards, 'school').map(([label, count]) => [label, count]);

  writeFile(path.join(analyticsDir, 'Topic Breakdown.md'), buildIndexNote(
    'Topic Breakdown',
    'Generated from the imported evidence library.',
    topicCounts
  ));

  writeFile(path.join(analyticsDir, 'Argument Types.md'), buildIndexNote(
    'Argument Types',
    'Generated from imported tags and body text classification.',
    argumentCounts
  ));

  writeFile(path.join(analyticsDir, 'Schools.md'), buildIndexNote(
    'Schools',
    'Schools represented in the imported archive.',
    schoolCounts
  ));

  writeFile(path.join(dashboardsDir, 'Community Cards.md'), buildIndexNote(
    'Community Cards',
    'Canonical and imported community cards from the archive.',
    [...topicGroups.entries()]
  ));

  writeFile(path.join(dashboardsDir, 'Argument Types.md'), buildIndexNote(
    'Argument Type Dashboard',
    'Grouped by inferred argument type.',
    [...argumentGroups.entries()]
  ));

  writeFile(path.join(dashboardsDir, 'Cite Groups.md'), buildIndexNote(
    'Cite Groups',
    'Grouped by short cite.',
    [...citeGroups.entries()].slice(0, 250)
  ));

  const home = `# Verbatim AI Library

## Import Status
- Imported Zip: ${meta.importedZip || 'Unknown'}
- Last Import: ${meta.lastImport || 'Unknown'}
- Cards Exported: ${cards.length}
- Docs Processed: ${meta.totalDocs || 0}
- Import Progress: ${meta.importProgress?.processedDocs || 0} / ${meta.importProgress?.totalDocs || 0} (${meta.importProgress?.percent || 0}%)
- Canonical Groups: ${meta.canonicalGroups || 0}
- Citation Groups: ${meta.citationGroups || 0}

## Dashboards
- [[Verbatim AI/Dashboards/Community Cards]]
- [[Verbatim AI/Dashboards/Argument Types]]
- [[Verbatim AI/Dashboards/Cite Groups]]

## Analytics
- [[Verbatim AI/Analytics/Topic Breakdown]]
- [[Verbatim AI/Analytics/Argument Types]]
- [[Verbatim AI/Analytics/Schools]]
`;

  writeFile(path.join(baseDir, 'Home.md'), home);

  const repoConfig = {
    obsidianVaultPath: vaultPath,
    obsidianApiUrl: 'http://127.0.0.1:27123',
    obsidianApiReachable: false,
    exportedAt: new Date().toISOString(),
    exportedCards: cards.length,
  };

  writeFile(path.resolve(__dirname, '..', 'obsidian-context.json'), JSON.stringify(repoConfig, null, 2));

  return {
    vaultPath,
    exportRoot: baseDir,
    exportedCards: cards.length,
  };
}

const result = exportToVault();
console.log(JSON.stringify(result, null, 2));
