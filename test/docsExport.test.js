'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { htmlToDocxBuffer } = require('../server/services/docsExport');

async function textOfDocx(buf) {
  const z = await JSZip.loadAsync(buf);
  return z.file('word/document.xml').async('text');
}

test('H1 maps to Heading1 with border', async () => {
  const buf = await htmlToDocxBuffer('<h1>Pocket</h1>');
  const xml = await textOfDocx(buf);
  assert.match(xml, /Heading1/);
  assert.match(xml, /<w:pBdr>/);
});

test('H2 double underline run', async () => {
  const buf = await htmlToDocxBuffer('<h2>Hat</h2>');
  const xml = await textOfDocx(buf);
  assert.match(xml, /w:val="double"/);
});

test('highlight span maps to yellow highlight', async () => {
  const buf = await htmlToDocxBuffer('<p><span style="background-color:#00ffff">hi</span></p>');
  const xml = await textOfDocx(buf);
  assert.match(xml, /<w:highlight/);
});

test('underline plus bold preserved', async () => {
  const buf = await htmlToDocxBuffer('<p><b><u>bu</u></b></p>');
  const xml = await textOfDocx(buf);
  assert.match(xml, /<w:b\/>/);
  assert.match(xml, /<w:u/);
});
