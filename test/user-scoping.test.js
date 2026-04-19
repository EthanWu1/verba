'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { useTempDb } = require('./_helpers');

async function bootAppWithProjects() {
  delete require.cache[require.resolve('../server/services/db')];
  delete require.cache[require.resolve('../server/services/auth')];
  delete require.cache[require.resolve('../server/middleware/requireUser')];
  delete require.cache[require.resolve('../server/routes/projects')];
  delete require.cache[require.resolve('../server/routes/auth')];
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', require('../server/routes/auth'));
  app.use('/api/projects', require('../server/routes/projects'));
  return new Promise((resolve) => {
    const srv = app.listen(0, () => resolve({ srv, port: srv.address().port }));
  });
}

async function signupAndCookie(port, email) {
  const r = await fetch(`http://127.0.0.1:${port}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'hunter22hunter22' }),
  });
  return r.headers.get('set-cookie').split(';')[0];
}

test('projects require auth and are isolated per user', async () => {
  const ctx = useTempDb();
  const { srv, port } = await bootAppWithProjects();
  try {
    const anon = await fetch(`http://127.0.0.1:${port}/api/projects`);
    assert.equal(anon.status, 401);

    const cookieA = await signupAndCookie(port, 'a@s.co');
    const cookieB = await signupAndCookie(port, 'b@s.co');

    const created = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ name: 'A Project' }),
    });
    assert.equal(created.status, 201);

    const listA = await (await fetch(`http://127.0.0.1:${port}/api/projects`, { headers: { Cookie: cookieA } })).json();
    const listB = await (await fetch(`http://127.0.0.1:${port}/api/projects`, { headers: { Cookie: cookieB } })).json();
    assert.equal(listA.items.length, 1);
    assert.equal(listB.items.length, 0);
  } finally { srv.close(); ctx.cleanup(); }
});
