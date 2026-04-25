#!/usr/bin/env node
'use strict';

/**
 * Probe Tabroom public endpoints to verify we can pull:
 *   1. List of upcoming tournaments
 *   2. Per-tournament field/entries (team codes)
 *
 * Usage: node scripts/_probe-tabroom-fields.js
 */

const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://www.tabroom.com';
const UA = 'Mozilla/5.0 (verba-probe; debate research)';

async function fetchHtml(path) {
  const res = await axios.get(BASE + path, {
    headers: { 'User-Agent': UA },
    timeout: 20000,
    validateStatus: () => true,
  });
  return { status: res.status, html: typeof res.data === 'string' ? res.data : '' };
}

async function probeIndex() {
  console.log('--- 1) Upcoming tournaments index ---');
  const { status, html } = await fetchHtml('/index/index.mhtml');
  console.log('GET /index/index.mhtml ->', status, 'bytes:', html.length);
  if (status !== 200) return [];
  const $ = cheerio.load(html);
  const rows = [];
  $('a[href*="tourn_id="]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const m = href.match(/tourn_id=(\d+)/);
    if (!m) return;
    const tournId = m[1];
    const name = $(a).text().trim();
    if (name && rows.findIndex(r => r.tournId === tournId) === -1) {
      rows.push({ tournId, name, href });
    }
  });
  console.log('Tournament-link count:', rows.length);
  console.log('First 5:', rows.slice(0, 5));
  return rows;
}

async function probeFields(tournId) {
  console.log(`\n--- 2) Field/entries for tourn_id=${tournId} ---`);
  const { status, html } = await fetchHtml(`/index/tourn/fields.mhtml?tourn_id=${tournId}`);
  console.log(`GET /index/tourn/fields.mhtml?tourn_id=${tournId} ->`, status, 'bytes:', html.length);
  if (status !== 200) return;
  const $ = cheerio.load(html);

  // Tabroom field pages list events as tables.
  // Common structure: each event has its own <table> with a row per entry.
  // Try a few selectors and dump what we find.

  console.log('Tables found:', $('table').length);
  console.log('Headings (h2/h3/h4):');
  $('h2, h3, h4').slice(0, 8).each((_, h) => console.log(' -', $(h).text().trim()));

  // Look for entry codes — typical pattern: <td class="smallish nowrap">CODE</td>
  // Or the entry page links to entry_id.
  const codes = new Set();
  $('a[href*="entry_id="]').slice(0, 30).each((_, a) => {
    const txt = $(a).text().trim();
    if (txt && txt.length < 60) codes.add(txt);
  });
  console.log('Sample entry codes (from entry_id links):', [...codes].slice(0, 10));

  // Also try generic table cell extraction for entry codes
  const cellCodes = new Set();
  $('table tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length >= 2) {
      const first = $(tds[0]).text().trim();
      // Heuristic: 2-4 word school + initials pattern e.g. "Greenhill MA"
      if (/^[A-Z][\w &.'-]+ +[A-Z]{1,4}$/.test(first)) cellCodes.add(first);
    }
  });
  console.log('Code-shaped cells:', [...cellCodes].slice(0, 10));
}

async function probeAlt(tournId) {
  console.log('\n--- 3) Map public endpoints for tourn_id=' + tournId + ' ---');
  const paths = [
    `/index/tourn/index.mhtml?tourn_id=${tournId}`,
    `/index/tourn/events.mhtml?tourn_id=${tournId}`,
    `/index/tourn/schools.mhtml?tourn_id=${tournId}`,
    `/index/tourn/judges.mhtml?tourn_id=${tournId}`,
    `/index/tourn/postings/index.mhtml?tourn_id=${tournId}`,
    `/index/results/index.mhtml?tourn_id=${tournId}`,
    `/index/results/results.mhtml?tourn_id=${tournId}`,
    `/api/tournaments/${tournId}`,
    `/api/tournaments/${tournId}/entries`,
  ];
  for (const p of paths) {
    const { status, html } = await fetchHtml(p);
    const isLogin = /Log In to Tabroom/i.test(html);
    const $ = cheerio.load(html || '');
    const title = $('title').text().trim();
    const h1 = $('h1').first().text().trim();
    console.log(`${status}${isLogin ? ' [LOGIN-WALL]' : ''}  ${p}  | title="${title.slice(0,60)}" h1="${h1.slice(0,40)}"  bytes=${html.length}`);
  }
}

(async () => {
  try {
    const upcoming = await probeIndex();
    if (upcoming.length) {
      console.log('\n--- 6) /api/download_data.mhtml schema inspection ---');
      // Pick a large completed/active tournament likely to have open data
      const t = upcoming.find(x => /National Speech and Debate Tournament/i.test(x.name)) || upcoming[0];
      const r = await axios.get(`${BASE}/api/download_data.mhtml?tourn_id=${t.tournId}`, {
        headers: { 'User-Agent': UA }, timeout: 30000, validateStatus: () => true,
      });
      console.log(`tourn_id=${t.tournId} (${t.name}) bytes=${JSON.stringify(r.data).length}`);
      if (r.data && typeof r.data === 'object') {
        console.log('Top-level keys:', Object.keys(r.data).slice(0, 40));
        for (const k of Object.keys(r.data).slice(0, 12)) {
          const v = r.data[k];
          if (Array.isArray(v)) {
            console.log(` ${k}: array len=${v.length}`);
            if (v[0]) console.log(`   sample[0] keys:`, Object.keys(v[0]).slice(0, 20));
          } else if (v && typeof v === 'object') {
            console.log(` ${k}: object keys:`, Object.keys(v).slice(0, 12));
          } else {
            console.log(` ${k}: ${typeof v} = ${String(v).slice(0, 50)}`);
          }
        }
        // Drill into schools[].students structure
        const schools = r.data.schools || [];
        console.log(`\n  schools: ${schools.length} entries`);
        if (schools[0]) {
          const s = schools[0];
          console.log(`  school[0] = { id:${s.id}, name:"${s.name}", students:${(s.students||[]).length} }`);
          if ((s.students || [])[0]) {
            console.log(`  student[0] keys:`, Object.keys(s.students[0]).slice(0, 20));
            console.log(`  student[0] sample:`, JSON.stringify(s.students[0]).slice(0, 400));
          }
        }
        // Check categories[].events for entry/team info
        const cats = r.data.categories || [];
        console.log(`\n  categories: ${cats.length}`);
        if (cats[0]?.events?.[0]) {
          const ev = cats[0].events[0];
          console.log(`  category[0].event[0] keys:`, Object.keys(ev).slice(0, 20));
          if (ev.entries) console.log(`    entries: array len=${ev.entries.length}`);
          if (ev.entries?.[0]) {
            console.log(`    entry[0] keys:`, Object.keys(ev.entries[0]).slice(0, 20));
            console.log(`    entry[0]:`, JSON.stringify(ev.entries[0]).slice(0, 400));
          }
        }
      }
      const tid = upcoming[5]?.tournId || upcoming[0].tournId;
      console.log('\n--- 4) Deep inspect schools.mhtml content ---');
      const { html } = await fetchHtml(`/index/tourn/schools.mhtml?tourn_id=${tid}`);
      const $ = cheerio.load(html);
      const schoolLinks = [];
      $('a[href*="school_id="]').slice(0, 8).each((_, a) => {
        schoolLinks.push({ name: $(a).text().trim().slice(0, 50), href: $(a).attr('href') });
      });
      console.log('school links found:', schoolLinks.length);
      console.log(schoolLinks);
      // Test schools-by-school entry view
      if (schoolLinks[0]) {
        console.log('\n--- 5) Per-school entries page ---');
        const r2 = await fetchHtml(schoolLinks[0].href);
        const $2 = cheerio.load(r2.html);
        const entries = [];
        $2('a[href*="entry_id="]').slice(0, 15).each((_, a) => entries.push($2(a).text().trim()));
        console.log('Status:', r2.status, 'Login-walled:', /Log In to Tabroom/i.test(r2.html));
        console.log('entry links sample:', entries);
        console.log('Tables on page:', $2('table').length);
      }
    }
  } catch (e) {
    console.error('PROBE ERROR:', e.message);
    process.exit(1);
  }
})();
