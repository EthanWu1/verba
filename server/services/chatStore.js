'use strict';
const crypto = require('crypto');
const { getDb } = require('./db');

function now() { return Date.now(); }

function createThread(userId, title = 'New thread') {
  const id = crypto.randomUUID();
  const t = now();
  getDb().prepare(`
    INSERT INTO chat_threads (id, userId, title, archived, createdAt, updatedAt)
    VALUES (?, ?, ?, 0, ?, ?)
  `).run(id, userId, title, t, t);
  return getThread(id, userId);
}

function getThread(id, userId) {
  return getDb().prepare('SELECT * FROM chat_threads WHERE id = ? AND userId = ?').get(id, userId) || null;
}

function listThreads(userId, { includeArchived = false } = {}) {
  const sql = includeArchived
    ? 'SELECT * FROM chat_threads WHERE userId = ? ORDER BY updatedAt DESC'
    : 'SELECT * FROM chat_threads WHERE userId = ? AND archived = 0 ORDER BY updatedAt DESC';
  return getDb().prepare(sql).all(userId);
}

function updateThread(id, userId, patch) {
  const fields = [];
  const args = [];
  for (const k of ['title', 'archived']) {
    if (k in patch) { fields.push(`${k} = ?`); args.push(patch[k]); }
  }
  if (!fields.length) return getThread(id, userId);
  fields.push('updatedAt = ?'); args.push(now());
  args.push(id, userId);
  getDb().prepare(`UPDATE chat_threads SET ${fields.join(', ')} WHERE id = ? AND userId = ?`).run(...args);
  return getThread(id, userId);
}

function deleteThread(id, userId) {
  getDb().prepare('DELETE FROM chat_threads WHERE id = ? AND userId = ?').run(id, userId);
}

function addMessage(threadId, role, content, { command = null, blockJson = null } = {}) {
  const id = crypto.randomUUID();
  const t = now();
  getDb().prepare(`
    INSERT INTO chat_messages (id, threadId, role, content, command, blockJson, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, threadId, role, content, command, blockJson ? JSON.stringify(blockJson) : null, t);
  getDb().prepare('UPDATE chat_threads SET updatedAt = ? WHERE id = ?').run(t, threadId);
  return { id, threadId, role, content, command, blockJson, createdAt: t };
}

function listMessages(threadId) {
  const rows = getDb().prepare('SELECT * FROM chat_messages WHERE threadId = ? ORDER BY createdAt ASC').all(threadId);
  return rows.map(r => ({ ...r, blockJson: r.blockJson ? JSON.parse(r.blockJson) : null }));
}

function addContext({ userId, name, kind, wordCount, content }) {
  const id = crypto.randomUUID();
  const t = now();
  getDb().prepare(`
    INSERT INTO chat_context (id, userId, name, kind, wordCount, content, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, name, kind, wordCount, content, t);
  return getContext(id, userId);
}

function getContext(id, userId) {
  return getDb().prepare('SELECT * FROM chat_context WHERE id = ? AND userId = ?').get(id, userId) || null;
}

function listContext(userId) {
  return getDb().prepare('SELECT id, name, kind, wordCount, createdAt FROM chat_context WHERE userId = ? ORDER BY createdAt DESC').all(userId);
}

function deleteContext(id, userId) {
  getDb().prepare('DELETE FROM chat_context WHERE id = ? AND userId = ?').run(id, userId);
}

module.exports = {
  createThread, getThread, listThreads, updateThread, deleteThread,
  addMessage, listMessages,
  addContext, getContext, listContext, deleteContext,
};
