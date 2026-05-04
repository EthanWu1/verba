'use strict';

/**
 * docxToMd.js — dump a Verbatim/Word .docx to {tag, cite, body_markdown}.
 * Used for tuning: hand-cut cards become the gold standard the cutter is
 * iterated against.
 *
 * Verbatim quirk: bold/underline are usually applied via Word style references
 * (<w:rStyle w:val="Emphasis"/>) rather than direct <w:b/> or <w:u/> tags.
 * The "Emphasis" style is redefined in Verbatim docx as bold+underline. So
 * we parse styles.xml first to build a styleId → {bold, underline} map and
 * resolve runs through it.
 *
 * Usage:
 *   node server/scripts/docxToMd.js path/to/file.docx [outdir]
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

function xmlDecode(text) {
  return String(text || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// Parse the styles.xml into a map: styleId → { bold, underline, basedOn }.
// Tag-based detection in the rPr block (<w:b/>, <w:u w:val="single"/>).
// `<w:b w:val="0"/>` explicitly negates bold; same for underline.
function parseStyles(stylesXml) {
  const styles = {};
  const blocks = stylesXml.split('<w:style ').slice(1);
  for (const blk of blocks) {
    const idMatch = blk.match(/styleId="([^"]+)"/);
    if (!idMatch) continue;
    const id = idMatch[1];
    const basedOn = (blk.match(/<w:basedOn[^>]+w:val="([^"]+)"/) || [])[1] || '';
    const rPrMatch = blk.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    const rPr = rPrMatch ? rPrMatch[1] : '';
    const boldOn  = /<w:b\b(?:\s*\/>|[^>]*w:val="(?!0)[^"]*"\s*\/>)/.test(rPr) || (/<w:b\b/.test(rPr) && !/<w:b\s+w:val="0"/.test(rPr));
    const boldOff = /<w:b\s+w:val="0"/.test(rPr);
    const undlOn  = /<w:u\b(?:\s*\/>|[^>]*w:val="(?!none)[^"]*"\s*\/>)/.test(rPr) || (/<w:u\b/.test(rPr) && !/<w:u\s+w:val="none"/.test(rPr));
    const undlOff = /<w:u\s+w:val="none"/.test(rPr);
    styles[id] = {
      basedOn,
      bold:      boldOn ? true : boldOff ? false : null,
      underline: undlOn ? true : undlOff ? false : null,
    };
  }
  // Resolve basedOn chains.
  function resolve(id, seen = new Set()) {
    if (seen.has(id)) return { bold: false, underline: false };
    seen.add(id);
    const s = styles[id];
    if (!s) return { bold: false, underline: false };
    let bold = s.bold;
    let underline = s.underline;
    if (s.basedOn && (bold === null || underline === null)) {
      const parent = resolve(s.basedOn, seen);
      if (bold === null) bold = parent.bold;
      if (underline === null) underline = parent.underline;
    }
    return { bold: bold === true, underline: underline === true };
  }
  const resolved = {};
  for (const id of Object.keys(styles)) resolved[id] = resolve(id);
  return resolved;
}

function parseRuns(paragraphXml, styleMap) {
  const runs = [];
  const runRegex = /<w:r\b[\s\S]*?<\/w:r>/g;
  let match;
  while ((match = runRegex.exec(paragraphXml)) !== null) {
    const runXml = match[0];
    const texts = [...runXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => xmlDecode(m[1]));
    const text = texts.join('');
    if (!text) continue;
    const rPrMatch = runXml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    const rPr = rPrMatch ? rPrMatch[1] : '';
    // Direct tag-level formatting.
    const directBold = /<w:b\b(?:\s*\/>|[^>]*w:val="(?!0)[^"]*"\s*\/>)/.test(rPr);
    const directBoldOff = /<w:b\s+w:val="0"/.test(rPr);
    const directUndl = /<w:u\b(?:\s*\/>|[^>]*w:val="(?!none)[^"]*"\s*\/>)/.test(rPr);
    const directUndlOff = /<w:u\s+w:val="none"/.test(rPr);
    // Style reference (resolved via styleMap).
    const styleRef = (rPr.match(/<w:rStyle[^>]+w:val="([^"]+)"/) || [])[1] || '';
    const refStyle = styleRef && styleMap[styleRef] ? styleMap[styleRef] : { bold: false, underline: false };
    const bold = directBoldOff ? false : (directBold || refStyle.bold);
    const underline = directUndlOff ? false : (directUndl || refStyle.underline);
    const highlight = /<w:highlight\b/.test(rPr);
    runs.push({ text, underline, bold, highlight });
  }
  return runs;
}

// Render runs to markdown, MERGING contiguous runs with the same formatting
// state. Without the merge, a 14-character span split into 5 sub-runs by the
// docx engine renders as 5 separate `**...**` blocks instead of one,
// producing visually-correct but textually-noisy markdown.
function runsToMarkdown(runs) {
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && last.bold === r.bold && last.underline === r.underline && last.highlight === r.highlight) {
      last.text += r.text;
    } else {
      merged.push({ ...r });
    }
  }
  return merged.map(run => {
    const clean = run.text.replace(/\s+/g, ' ');
    if (!clean.trim()) return run.text;
    if (run.highlight && (run.underline || run.bold)) {
      const inner = run.bold ? `**<u>${clean}</u>**` : `<u>${clean}</u>`;
      return `==${inner}==`;
    }
    if (run.bold && run.underline) return `**<u>${clean}</u>**`;
    if (run.underline) return `<u>${clean}</u>`;
    if (run.bold) return `**${clean}**`;
    return clean;
  }).join('').replace(/[ \t]+/g, ' ').trim();
}

function extractParagraphs(documentXml, styleMap) {
  const paragraphs = [];
  const paragraphRegex = /<w:p\b[\s\S]*?<\/w:p>/g;
  let match;
  while ((match = paragraphRegex.exec(documentXml)) !== null) {
    const xml = match[0];
    const styleMatch = xml.match(/<w:pStyle\s+w:val="([^"]+)"/);
    const style = styleMatch ? styleMatch[1] : '';
    const runs = parseRuns(xml, styleMap);
    if (!runs.length) continue;
    const md = runsToMarkdown(runs);
    if (!md) continue;
    const plain = runs.map(r => r.text).join('').replace(/\s+/g, ' ').trim();
    paragraphs.push({ markdown: md, plain, style });
  }
  return paragraphs;
}

function looksLikeCite(plain) {
  // "Lastname '23 [...", "Lastname 23 (..." (parenthetical), "Lastname 23, ..."
  return /^[A-Z][A-Za-z.\-]+\s+'?\d{2,4}\b\s*[\[(,]/.test(plain) ||
    /^[A-Z][A-Za-z.\-]+\s+\d{1,2}\/\d{1,2}/.test(plain);
}
function isHeadingStyle(style) { return /^Heading\d/i.test(style); }
// Treat short, mostly-bolded paragraphs as tags when there's no Heading style.
function looksLikeTagFromMarkup(p) {
  if (p.style && isHeadingStyle(p.style)) return true;
  const text = p.plain || '';
  if (text.length === 0 || text.length > 400) return false;
  // Count chars inside ** ** in the markdown — if most of the paragraph is
  // bolded, it's almost certainly a tag.
  const md = p.markdown || '';
  const boldChars = (md.match(/\*\*[\s\S]*?\*\*/g) || [])
    .reduce((a, m) => a + m.replace(/[*<>u/]/g, '').length, 0);
  return boldChars > text.length * 0.6;
}

function groupCards(paragraphs) {
  const cards = [];
  let cur = null;
  let sawBody = false;
  for (const p of paragraphs) {
    const isTag = looksLikeTagFromMarkup(p);
    const startsNew = isTag || (looksLikeCite(p.plain) && (!cur || sawBody));
    if (startsNew && cur && (cur.cite || cur.bodyParas.length)) {
      cards.push(cur);
      cur = null;
      sawBody = false;
    }
    if (!cur) cur = { tag: '', cite: '', bodyParas: [] };
    if (isTag && !cur.tag) {
      cur.tag = p.plain;
      continue;
    }
    if (looksLikeCite(p.plain) && !cur.cite) {
      cur.cite = p.plain;
      continue;
    }
    cur.bodyParas.push(p.markdown);
    sawBody = true;
  }
  if (cur && (cur.cite || cur.bodyParas.length)) cards.push(cur);
  return cards;
}

function slugify(s, max = 40) {
  return String(s || 'card').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length) {
    console.error('Usage: node server/scripts/docxToMd.js <file.docx> [outdir]');
    process.exit(2);
  }
  const filePath = path.resolve(argv[0]);
  const outDir = argv[1] ? path.resolve(argv[1]) : null;

  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);
  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    console.error('Not a Word .docx (no word/document.xml found).');
    process.exit(1);
  }
  const stylesFile = zip.file('word/styles.xml');
  const stylesXml = stylesFile ? await stylesFile.async('string') : '';
  const styleMap = stylesXml ? parseStyles(stylesXml) : {};
  const xml = await docFile.async('string');
  const paragraphs = extractParagraphs(xml, styleMap);
  const cards = groupCards(paragraphs);

  if (!cards.length) {
    console.error(`No cards detected. Paragraphs: ${paragraphs.length}.`);
    process.exit(1);
  }

  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    cards.forEach((c, i) => {
      const slug = slugify(c.tag || c.cite || `card-${i}`);
      const file = path.join(outDir, `${String(i + 1).padStart(2, '0')}-${slug}.md`);
      const md = [
        c.tag && `# ${c.tag}`,
        c.cite && `**Cite:** ${c.cite}`,
        '',
        c.bodyParas.join('\n\n'),
      ].filter(Boolean).join('\n');
      fs.writeFileSync(file, md, 'utf8');
      console.log(`wrote ${file}`);
    });
  } else {
    for (const c of cards) {
      console.log('---');
      if (c.tag)  console.log(`# ${c.tag}`);
      if (c.cite) console.log(`**Cite:** ${c.cite}\n`);
      console.log(c.bodyParas.join('\n\n'));
      console.log();
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
