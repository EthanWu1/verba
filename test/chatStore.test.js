'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../server/services/chatStore');
const { getDb } = require('../server/services/db');

test.beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM chat_messages').run();
  db.prepare('DELETE FROM chat_threads').run();
  db.prepare('DELETE FROM chat_context').run();
});

test('createThread + listThreads', () => {
  const t = store.createThread('u1', 'First');
  // listThreads filters HAVING messageCount > 0 AND nameSet = 1 — fresh
  // threads stay hidden until they have a message AND have been named by
  // the AI auto-rename. Both gates exist so half-finished lazy-creates and
  // unrenamed drafts don't pile up in the picker.
  store.addMessage(t.id, 'user', 'hi');
  store.markThreadNamed(t.id, 'u1', 'First');
  const rows = store.listThreads('u1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'First');
  assert.equal(rows[0].nameSet, 1);
});

test('listThreads hides unnamed threads (nameSet=0)', () => {
  const t = store.createThread('u1', 'pending');
  store.addMessage(t.id, 'user', 'hi'); // has message but rename hasn't fired
  const rows = store.listThreads('u1');
  assert.equal(rows.length, 0, 'unnamed thread should be hidden from picker');
});

test('markThreadNamed flips nameSet and updates title', () => {
  const t = store.createThread('u1', 'placeholder');
  store.addMessage(t.id, 'user', 'hi');
  const updated = store.markThreadNamed(t.id, 'u1', 'AI Generated Title');
  assert.equal(updated.title, 'AI Generated Title');
  assert.equal(updated.nameSet, 1);
  const rows = store.listThreads('u1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'AI Generated Title');
});

test('addMessage + listMessages ordered by createdAt', () => {
  const t = store.createThread('u1', 'x');
  store.addMessage(t.id, 'user', 'hi');
  store.addMessage(t.id, 'assistant', 'hello');
  const msgs = store.listMessages(t.id);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs[1].role, 'assistant');
});

test('deleteThread cascades messages', () => {
  const t = store.createThread('u1', 'x');
  store.addMessage(t.id, 'user', 'hi');
  store.deleteThread(t.id, 'u1');
  assert.equal(store.listMessages(t.id).length, 0);
});

test('archiveThread hides from default list', () => {
  const t = store.createThread('u1', 'x');
  store.addMessage(t.id, 'user', 'hi');
  store.markThreadNamed(t.id, 'u1', 'named'); // satisfy nameSet filter
  store.updateThread(t.id, 'u1', { archived: 1 });
  assert.equal(store.listThreads('u1').length, 0);
  assert.equal(store.listThreads('u1', { includeArchived: true }).length, 1);
});

test('addContext + listContext', () => {
  const c = store.addContext({ userId: 'u1', name: 'f.docx', kind: 'docx', wordCount: 100, content: 'hello world' });
  const list = store.listContext('u1');
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'f.docx');
});

test('deleteContext removes row', () => {
  const c = store.addContext({ userId: 'u1', name: 'f.docx', kind: 'docx', wordCount: 10, content: 'x' });
  store.deleteContext(c.id, 'u1');
  assert.equal(store.listContext('u1').length, 0);
});
