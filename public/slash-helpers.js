'use strict';
function expandCommand(name, rawArg) {
  const arg = String(rawArg || '').trim();
  switch (name) {
    case '/clear':
      return { action: 'clear' };
    case '/find':
      return { action: 'find', arg };
    case '/block':
      if (!arg) return { action: 'prefill', prefill: '/block ' };
      return {
        action: 'send',
        display: `/block ${arg}`,
        send: `Write a block on: ${arg}. Use cards only if they actually help; otherwise give analytics, warrants, and framing. Choose the number of cards based on what's useful — not a fixed count.`,
      };
    case '/explain':
      if (!arg) return { action: 'prefill', prefill: '/explain ' };
      return {
        action: 'send',
        display: `/explain ${arg}`,
        send: `Explain: ${arg}. State warrants, impact, and a response to the most likely answer.`,
      };
    default:
      return null;
  }
}

function shouldKeepSlashOpen(inputValue, matchedCmds) {
  const v = String(inputValue || '');
  if (!v.startsWith('/')) return false;
  if (!matchedCmds || !matchedCmds.length) return false;
  if (v.includes(' ')) return false;
  const firstWord = v.split(' ')[0];
  if (matchedCmds.length === 1 && matchedCmds[0] === firstWord) return false;
  return true;
}
if (typeof module !== 'undefined') module.exports = { shouldKeepSlashOpen, expandCommand };
if (typeof window !== 'undefined') { window.__shouldKeepSlashOpen = shouldKeepSlashOpen; window.__expandCommand = expandCommand; }
