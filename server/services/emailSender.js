'use strict';
const nodemailer = require('nodemailer');

let _transporter = null;
function transporter() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transporter;
}

async function sendPasswordReset(to, resetUrl) {
  if (process.env.SMTP_SKIP === '1') {
    console.log('[email:skip] password reset →', to, resetUrl);
    return { skipped: true };
  }
  return transporter().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: 'Reset your Verba password',
    text: `Click to reset your password (expires in 1 hour):\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
    html: `<p>Click to reset your password (expires in 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, ignore this email.</p>`,
  });
}

module.exports = { sendPasswordReset };
