'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// Stub better-sqlite3 + sqlite-vec so requiring the route module doesn't
// open a real database. We only exercise the pure helpers exported via
// __testables; the SQL layer has its own test path.
function withStubbedDeps(fn) {
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function(request, parent, ...rest) {
    if (request === 'better-sqlite3' || request === 'sqlite-vec') {
      return require.resolve('module'); // any harmless stub
    }
    return origResolve.call(this, request, parent, ...rest);
  };
  try { return fn(); } finally { Module._resolveFilename = origResolve; }
}

// Re-derive sanitizeFtsQuery from source to keep this test independent of
// route bootstrapping (which pulls in db.js and would need a real DB).
function loadSanitizer() {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'library.js'), 'utf8');
  const fnSrc = src.match(/function sanitizeFtsQuery[\s\S]*?\n\}/)[0];
  // eslint-disable-next-line no-new-func
  return new Function(`${fnSrc}; return sanitizeFtsQuery;`)();
}

test('sanitizeFtsQuery applies prefix * so unicode61 matches morphology', () => {
  const sanitize = loadSanitizer();
  assert.equal(sanitize('psychoanalysis'), '"psychoanalysis"*');
});

test('sanitizeFtsQuery ANDs multiple tokens with prefix on each', () => {
  const sanitize = loadSanitizer();
  assert.equal(sanitize('nuclear war'), '"nuclear"* AND "war"*');
});

test('sanitizeFtsQuery strips FTS5 special chars', () => {
  const sanitize = loadSanitizer();
  // colon, paren, asterisk, quotes are stripped before quoting
  assert.equal(sanitize('foo:bar(baz)*'), '"foo"* AND "bar"* AND "baz"*');
});

test('sanitizeFtsQuery returns null for empty input', () => {
  const sanitize = loadSanitizer();
  assert.equal(sanitize(''), null);
  assert.equal(sanitize('   '), null);
});

test('sanitizeFtsQuery handles wrapping quotes/dashes', () => {
  const sanitize = loadSanitizer();
  assert.equal(sanitize('"escalation"'), '"escalation"*');
  assert.equal(sanitize('mind-body'), '"mind"* AND "body"*');
});

void withStubbedDeps; // reserved for future route-level integration tests
