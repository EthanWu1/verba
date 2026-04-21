'use strict';
function shouldKeepSlashOpen(inputValue, matchedCmds) {
  const v = String(inputValue || '');
  if (!v.startsWith('/')) return false;
  if (!matchedCmds || !matchedCmds.length) return false;
  if (v.includes(' ')) return false;
  const firstWord = v.split(' ')[0];
  if (matchedCmds.length === 1 && matchedCmds[0] === firstWord) return false;
  return true;
}
if (typeof module !== 'undefined') module.exports = { shouldKeepSlashOpen };
if (typeof window !== 'undefined') window.__shouldKeepSlashOpen = shouldKeepSlashOpen;
