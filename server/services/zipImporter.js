'use strict';

const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function resolveProjectPath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('zipPath is required.');
  }

  const resolved = path.resolve(PROJECT_ROOT, inputPath);
  if (!resolved.startsWith(PROJECT_ROOT)) {
    throw new Error('zipPath must stay inside the project directory.');
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${inputPath}`);
  }

  if (path.extname(resolved).toLowerCase() !== '.zip') {
    throw new Error('Only .zip imports are supported.');
  }

  return resolved;
}

async function listZipEntries(zipPath) {
  const resolved = resolveProjectPath(zipPath);
  // unzipper.Open reads only the central directory — no 2GiB limit
  const directory = await unzipper.Open.file(resolved);
  const entries = directory.files
    .filter(f => !f.type || f.type === 'File')
    .map(f => f.path);
  return { resolved, entries, directory };
}

function summarizeEntries(entries, sampleSize = 25) {
  const docxEntries = entries.filter(entry => entry.toLowerCase().endsWith('.docx'));
  const schoolCounts = new Map();
  const teamCounts = new Map();

  docxEntries.forEach(entry => {
    const parts = entry.split('/').filter(Boolean);
    const school = parts[1] || 'Unknown';
    const team = parts[2] || 'Unknown';

    schoolCounts.set(school, (schoolCounts.get(school) || 0) + 1);
    teamCounts.set(`${school}/${team}`, (teamCounts.get(`${school}/${team}`) || 0) + 1);
  });

  const topSchools = [...schoolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([school, files]) => ({ school, files }));

  const topTeams = [...teamCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([key, files]) => {
      const [school, team] = key.split('/');
      return { school, team, files };
    });

  return {
    entryCount: entries.length,
    docxCount: docxEntries.length,
    sample: docxEntries.slice(0, sampleSize).map(entry => {
      const parts = entry.split('/').filter(Boolean);
      return {
        entry,
        division: parts[0] || '',
        school: parts[1] || '',
        squad: parts[2] || '',
        fileName: parts[parts.length - 1] || entry,
      };
    }),
    topSchools,
    topTeams,
  };
}

async function previewZipImport(zipPath, sampleSize = 25) {
  const { resolved, entries } = await listZipEntries(zipPath);
  return {
    zipPath,
    resolvedPath: resolved,
    ...summarizeEntries(entries, sampleSize),
  };
}

module.exports = {
  previewZipImport,
  resolveProjectPath,
  listZipEntries,
};
