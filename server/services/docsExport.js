'use strict';
const cheerio = require('cheerio');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, BorderStyle,
} = require('docx');

/**
 * Walk inline nodes and collect TextRun descriptors (plain objects).
 * overrideCtx is merged into every leaf ctx — used by heading paths
 * to force bold/underline without needing to mutate TextRun instances.
 */
function runsFromInline($, node, overrideCtx) {
  const runs = [];
  const walk = (el, ctx) => {
    if (el.type === 'text') {
      if (!el.data) return;
      const merged = { ...ctx, ...overrideCtx };
      runs.push(new TextRun({
        text: el.data,
        bold: merged.bold || undefined,
        italics: merged.italic || undefined,
        underline: merged.double
          ? { type: 'double' }
          : merged.underline
            ? { type: 'single' }
            : undefined,
        highlight: merged.highlight || undefined,
        font: merged.font || 'Calibri',
        size: merged.size ? merged.size * 2 : undefined,
      }));
      return;
    }
    if (el.type !== 'tag') return;
    const tag = (el.name || '').toLowerCase();
    const next = { ...ctx };
    if (tag === 'b' || tag === 'strong') next.bold = true;
    if (tag === 'i' || tag === 'em') next.italic = true;
    if (tag === 'u') next.underline = true;
    const style = (el.attribs && el.attribs.style) || '';
    const bg = /background(?:-color)?:\s*(#[0-9a-f]{3,8}|cyan|yellow)/i.exec(style);
    if (bg) next.highlight = 'cyan';
    const fontMatch = /font-family:\s*([^;]+)/i.exec(style);
    if (fontMatch) next.font = fontMatch[1].replace(/['"]/g, '').split(',')[0].trim();
    const sizeMatch = /font-size:\s*(\d+)pt/i.exec(style);
    if (sizeMatch) next.size = Number(sizeMatch[1]);
    const $el = $(el);
    $el.contents().toArray().forEach(c => walk(c, next));
  };
  $(node).contents().toArray().forEach(c => walk(c, {}));
  return runs;
}

function paragraphFromBlock($, el, heading) {
  const opts = {};
  if (heading === 1) {
    opts.heading = HeadingLevel.HEADING_1;
    opts.border = {
      top:    { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      left:   { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      right:  { style: BorderStyle.SINGLE, size: 6, color: '000000' },
    };
    opts.children = runsFromInline($, el, { bold: true });
  } else if (heading === 2) {
    opts.heading = HeadingLevel.HEADING_2;
    opts.children = runsFromInline($, el, { bold: true, double: true });
  } else if (heading === 3) {
    opts.heading = HeadingLevel.HEADING_3;
    opts.children = runsFromInline($, el, { bold: true, underline: true });
  } else if (heading === 4) {
    opts.heading = HeadingLevel.HEADING_4;
    opts.children = runsFromInline($, el, { bold: true });
  } else {
    opts.children = runsFromInline($, el, {});
  }
  return new Paragraph(opts);
}

async function htmlToDocxBuffer(html) {
  const $ = cheerio.load(`<body>${html}</body>`);
  const paragraphs = [];
  $('body').contents().each((_, el) => {
    if (el.type !== 'tag') return;
    const tag = el.name.toLowerCase();
    const h = { h1: 1, h2: 2, h3: 3, h4: 4 }[tag];
    paragraphs.push(paragraphFromBlock($, el, h || null));
  });
  if (!paragraphs.length) paragraphs.push(new Paragraph({ children: [] }));
  const doc = new Document({ sections: [{ children: paragraphs }] });
  return Packer.toBuffer(doc);
}

module.exports = { htmlToDocxBuffer };
