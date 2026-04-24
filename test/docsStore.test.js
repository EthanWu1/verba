'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../server/services/docsStore');
const { getDb } = require('../server/services/db');

test.beforeEach(() => { getDb().prepare('DELETE FROM docs').run(); });

test('createDoc inserts file with content', () => {
  const doc = store.createDoc({ userId: 'u1', kind: 'file', name: 'A', parentId: null, contentHtml: '<p>hi</p>' });
  assert.equal(doc.kind, 'file');
  assert.equal(doc.name, 'A');
  assert.equal(doc.contentHtml, '<p>hi</p>');
});

test('listDocs returns only caller user rows', () => {
  store.createDoc({ userId: 'u1', kind: 'file', name: 'mine' });
  store.createDoc({ userId: 'u2', kind: 'file', name: 'other' });
  const rows = store.listDocs('u1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'mine');
});

test('updateDoc changes name and contentHtml', () => {
  const d = store.createDoc({ userId: 'u1', kind: 'file', name: 'A' });
  store.updateDoc(d.id, 'u1', { name: 'B', contentHtml: '<p>x</p>' });
  const got = store.getDoc(d.id, 'u1');
  assert.equal(got.name, 'B');
  assert.equal(got.contentHtml, '<p>x</p>');
});

test('deleteDoc cascades children', () => {
  const folder = store.createDoc({ userId: 'u1', kind: 'folder', name: 'f' });
  store.createDoc({ userId: 'u1', kind: 'file', name: 'child', parentId: folder.id });
  store.deleteDoc(folder.id, 'u1');
  assert.equal(store.listDocs('u1').length, 0);
});

test('getDoc returns null for other-user id', () => {
  const d = store.createDoc({ userId: 'u1', kind: 'file', name: 'A' });
  assert.equal(store.getDoc(d.id, 'u2'), null);
});
