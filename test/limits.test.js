'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { useTempDb } = require('./_helpers');

test('limits.hit increments counter and enforces cap', () => {
  const ctx = useTempDb();
  try {
    delete require.cache[require.resolve('../server/services/db')];
    delete require.cache[require.resolve('../server/services/limits')];
    delete require.cache[require.resolve('../server/services/auth')];
    const auth = require('../server/services/auth');
    const limits = require('../server/services/limits');
    const u = auth._insertUserSync({ email: 'lim@x.co', passwordHash: 'h' });

    assert.equal(limits.getCount(u.id, 'chat'), 0);
    for (let i = 0; i < 3; i++) limits.hit(u.id, 'chat');
    assert.equal(limits.getCount(u.id, 'chat'), 3);

    const before = limits.checkAndBudget(u.id, 'chat', 5);
    assert.equal(before.allowed, true);
    assert.equal(before.remaining, 2);

    limits.hit(u.id, 'chat'); limits.hit(u.id, 'chat');
    const after = limits.checkAndBudget(u.id, 'chat', 5);
    assert.equal(after.allowed, false);
    assert.equal(after.remaining, 0);
  } finally { ctx.cleanup(); }
});
