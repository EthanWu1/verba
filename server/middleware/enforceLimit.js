'use strict';
const limits = require('../services/limits');

function enforceLimit(kind, limit) {
  return function (req, res, next) {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'not authenticated' });
    const verdict = limits.checkAndBudget(user.id, kind, limit, user);
    if (!verdict.allowed) {
      return res.status(429).json({
        error: 'free tier limit reached',
        kind,
        limit: verdict.limit,
        remaining: 0,
        resetAt: limits.nextResetAt(),
      });
    }
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        try { limits.hit(user.id, kind); } catch {}
      }
    });
    next();
  };
}

module.exports = enforceLimit;
