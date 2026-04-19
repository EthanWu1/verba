'use strict';
const { validateSession } = require('../services/auth');

function requireUser(req, res, next) {
  const sid = req.cookies && req.cookies['verba.sid'];
  const ctx = validateSession(sid);
  if (!ctx) return res.status(401).json({ error: 'not authenticated' });
  req.user = ctx.user;
  req.sessionId = ctx.session.id;
  next();
}

module.exports = requireUser;
