'use strict';

const cheerio = require('cheerio');
const docx = require('docx');

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  UnderlineType,
  convertInchesToTwip,
} = docx;

const FONT = 'Calibri';
const PILCROW = '\u00B6';
const PT = value => value * 2;
const BODY_COLOR = '111111';
const HIGHLIGHT_COLOR = 'yellow';

async function buildDocx(card) {
  const {
    pocket = '',
    hat = '',
    block = '',
    tag = '',
    cite = '',
    body_markdown = '',
    body_html = '',
  } = card;

  const children = [];

  if (pocket) {
    children.push(new Paragraph({ text: pocket, heading: HeadingLevel.HEADING_1, style: 'Heading1' }));
  }

  if (hat) {
    children.push(new Paragraph({ text: hat, heading: HeadingLevel.HEADING_2, style: 'Heading2' }));
  }

  if (block) {
    children.push(new Paragraph({ text: block, heading: HeadingLevel.HEADING_3, style: 'Heading3' }));
  }

  if (tag) {
    children.push(new Paragraph({ text: tag, heading: HeadingLevel.HEADING_4, style: 'Heading4' }));
  }

  if (cite) {
    children.push(new Paragraph({ children: buildCiteRuns(cite), style: 'Cite' }));
  }

  if (body_html) {
    children.push(...buildBodyParagraphsFromHtml(body_html));
  } else if (body_markdown) {
    children.push(...buildBodyParagraphsFromMarkdown(body_markdown));
  }

  const document = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: FONT,
            size: PT(8),
            color: BODY_COLOR,
          },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: FONT, size: PT(24), bold: true, color: BODY_COLOR },
          paragraph: { spacing: { before: 120, after: 30 } },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: FONT, size: PT(18), bold: true, color: BODY_COLOR },
          paragraph: { spacing: { before: 80, after: 20 } },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: FONT, size: PT(15), bold: true, color: BODY_COLOR },
          paragraph: { spacing: { before: 60, after: 20 } },
        },
        {
          id: 'Heading4',
          name: 'Heading 4',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: FONT, size: PT(13), bold: true, color: BODY_COLOR },
          paragraph: { spacing: { before: 30, after: 10 } },
        },
        {
          id: 'Cite',
          name: 'Cite',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: FONT, size: PT(10.5), color: BODY_COLOR },
          paragraph: { spacing: { before: 0, after: 20 } },
        },
      ],
      characterStyles: [
        {
          id: 'Emphasis',
          name: 'Emphasis',
          run: {
            font: FONT,
            bold: true,
            underline: { type: UnderlineType.SINGLE },
            color: BODY_COLOR,
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}

async function buildProjectDocx(projectName, cards) {
  const children = [];
  children.push(new Paragraph({ text: projectName || 'Project', heading: HeadingLevel.HEADING_1, style: 'Heading1' }));

  (cards || []).forEach((card, idx) => {
    const { pocket = '', hat = '', block = '', tag = '', cite = '', body_markdown = '', body_html = '' } = card || {};
    if (idx > 0) children.push(new Paragraph({ text: '' }));
    if (pocket) children.push(new Paragraph({ text: pocket, heading: HeadingLevel.HEADING_2, style: 'Heading2' }));
    if (hat) children.push(new Paragraph({ text: hat, heading: HeadingLevel.HEADING_3, style: 'Heading3' }));
    if (block) children.push(new Paragraph({ text: block, heading: HeadingLevel.HEADING_4, style: 'Heading4' }));
    if (tag) children.push(new Paragraph({ text: tag, heading: HeadingLevel.HEADING_4, style: 'Heading4' }));
    if (cite) children.push(new Paragraph({ children: buildCiteRuns(cite), style: 'Cite' }));
    if (body_html) children.push(...buildBodyParagraphsFromHtml(body_html));
    else if (body_markdown) children.push(...buildBodyParagraphsFromMarkdown(body_markdown));
  });

  const document = new Document({
    styles: {
      default: { document: { run: { font: FONT, size: PT(8), color: BODY_COLOR } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: PT(24), bold: true, color: BODY_COLOR }, paragraph: { spacing: { before: 120, after: 30 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: PT(18), bold: true, color: BODY_COLOR }, paragraph: { spacing: { before: 80, after: 20 } } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: PT(15), bold: true, color: BODY_COLOR }, paragraph: { spacing: { before: 60, after: 20 } } },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: PT(13), bold: true, color: BODY_COLOR }, paragraph: { spacing: { before: 30, after: 10 } } },
        { id: 'Cite', name: 'Cite', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: PT(10.5), color: BODY_COLOR }, paragraph: { spacing: { before: 0, after: 20 } } },
      ],
      characterStyles: [
        { id: 'Emphasis', name: 'Emphasis', run: { font: FONT, bold: true, underline: { type: UnderlineType.SINGLE }, color: BODY_COLOR } },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1), right: convertInchesToTwip(1) } } },
      children,
    }],
  });

  return Packer.toBuffer(document);
}

function buildCiteRuns(citeString) {
  const normalized = String(citeString || '').trim();
  const match = normalized.match(/^(\S+\s+'?\d{2,4})(\b.*)?$/s);

  if (!match) {
    return [new TextRun({ text: normalized, font: FONT, size: PT(11), color: '000000' })];
  }

  const rest = match[2] || '';
  const restText = rest ? (rest.startsWith(' ') ? rest : ' ' + rest.trim()) : '';
  return [
    new TextRun({ text: match[1], font: FONT, size: PT(13), bold: true, color: '000000' }),
    new TextRun({ text: restText, font: FONT, size: PT(11), bold: false, color: '000000' }),
  ];
}

function buildBodyParagraphsFromHtml(bodyHtml) {
  const $ = cheerio.load(`<root>${bodyHtml}</root>`, { decodeEntities: false });
  const paragraphs = $('root').children('p').toArray();

  return paragraphs.map(node => new Paragraph({ children: htmlChildrenToRuns($, node.children || [], baseState()) }));
}

function baseState() {
  return { bold: false, underline: false, highlight: false, big: false };
}

function htmlChildrenToRuns($, nodes, state) {
  const runs = [];
  nodes.forEach(node => {
    runs.push(...htmlNodeToRuns($, node, state));
  });
  return runs.length ? runs : [makeRun('', state)];
}

function htmlNodeToRuns($, node, state) {
  if (node.type === 'text') {
    return node.data ? [makeRun(node.data, state)] : [];
  }

  if (node.type !== 'tag') return [];

  if (node.name === 'br') {
    return [makeRun(' ', state)];
  }

  if (node.name === 'b' || node.name === 'strong') {
    return htmlChildrenToRuns($, node.children || [], { ...state, bold: true, big: true });
  }

  if (node.name === 'u') {
    return htmlChildrenToRuns($, node.children || [], { ...state, underline: true, big: true });
  }

  if (node.name === 'mark') {
    return htmlChildrenToRuns($, node.children || [], { ...state, highlight: true });
  }

  if (node.name === 'span') {
    const classNames = (($(node).attr('class') || '').split(/\s+/).filter(Boolean));
    if (classNames.includes('pilcrow')) {
      return [makeRun(` ${PILCROW} `, state)];
    }

    const next = { ...state };
    if (classNames.includes('fmt-underline')) {
      next.underline = true;
      next.big = true;
    }
    if (classNames.includes('fmt-verbatimize')) {
      next.bold = true;
      next.underline = true;
      next.big = true;
    }
    if (classNames.includes('fmt-highlight')) {
      next.highlight = true;
    }

    return htmlChildrenToRuns($, node.children || [], next);
  }

  return htmlChildrenToRuns($, node.children || [], state);
}

function makeRun(text, state) {
  const run = {
    text,
    font: FONT,
    size: state.big ? PT(11) : PT(8),
    color: BODY_COLOR,
  };

  if (state.bold) run.bold = true;
  if (state.underline) run.underline = { type: UnderlineType.SINGLE };
  if (state.highlight) run.highlight = HIGHLIGHT_COLOR;
  if (state.bold && state.underline) run.style = 'Emphasis';

  return new TextRun(run);
}

function buildBodyParagraphsFromMarkdown(markdown) {
  return String(markdown || '')
    .split(/\n\n+/)
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .map(chunk => new Paragraph({ children: parseInlineMarkdown(chunk) }));
}

function parseInlineMarkdown(text, state = baseState()) {
  const runs = [];
  const tokenRe = /(==[\s\S]*?==)|([*][*]<u>[\s\S]*?<\/u>[*][*])|([*][*][\s\S]*?[*][*])|(<u>[\s\S]*?<\/u>)|(\u00B6)|([^<>=*\u00B6]+|[<>=*])/g;
  let match;

  while ((match = tokenRe.exec(text)) !== null) {
    const [, highlighted, verbatized, bolded, underlined, pilcrow, plain] = match;

    if (highlighted) {
      const inner = highlighted.slice(2, -2);
      runs.push(...parseInlineMarkdown(inner, { ...state, highlight: true }));
      continue;
    }
    if (verbatized) {
      const inner = verbatized.replace(/^\*\*<u>/, '').replace(/<\/u>\*\*$/, '');
      runs.push(...parseInlineMarkdown(inner, { ...state, bold: true, underline: true, big: true }));
      continue;
    }
    if (bolded) {
      const inner = bolded.slice(2, -2);
      runs.push(...parseInlineMarkdown(inner, { ...state, bold: true, big: true }));
      continue;
    }
    if (underlined) {
      const inner = underlined.replace(/^<u>/, '').replace(/<\/u>$/, '');
      runs.push(...parseInlineMarkdown(inner, { ...state, underline: true, big: true }));
      continue;
    }
    if (pilcrow) {
      runs.push(makeRun(` ${PILCROW} `, state));
      continue;
    }
    if (plain) {
      runs.push(makeRun(plain, state));
    }
  }

  return runs.length ? runs : [makeRun('', state)];
}

module.exports = { buildDocx, buildProjectDocx };
