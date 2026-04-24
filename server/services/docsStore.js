'use strict';
const crypto = require('crypto');
const { getDb } = require('./db');

function createDoc({ userId, kind, name, parentId = null, contentHtml = null }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  getDb().prepare(`
    INSERT INTO docs (id, userId, parentId, kind, name, contentHtml, sortOrder, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(id, userId, parentId, kind, name, contentHtml, now, now);
  return getDoc(id, userId);
}

function getDoc(id, userId) {
  return getDb().prepare('SELECT * FROM docs WHERE id = ? AND userId = ?').get(id, userId) || null;
}

function listDocs(userId) {
  return getDb().prepare('SELECT id, parentId, kind, name, sortOrder, updatedAt FROM docs WHERE userId = ? ORDER BY sortOrder, name').all(userId);
}

function updateDoc(id, userId, patch) {
  const fields = [];
  const args = [];
  for (const k of ['name', 'parentId', 'contentHtml', 'sortOrder']) {
    if (k in patch) { fields.push(`${k} = ?`); args.push(patch[k]); }
  }
  if (!fields.length) return getDoc(id, userId);
  fields.push('updatedAt = ?'); args.push(Date.now());
  args.push(id, userId);
  getDb().prepare(`UPDATE docs SET ${fields.join(', ')} WHERE id = ? AND userId = ?`).run(...args);
  return getDoc(id, userId);
}

function deleteDoc(id, userId) {
  getDb().prepare('DELETE FROM docs WHERE id = ? AND userId = ?').run(id, userId);
}

module.exports = { createDoc, getDoc, listDocs, updateDoc, deleteDoc };
