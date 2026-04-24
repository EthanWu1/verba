// public/lib/filesClipboard.js — thin wrapper for "Copy all" toolbar button
(function(global){
  'use strict';
  async function copyAll(rootEl) {
    const Clipboard = global.Clipboard || global.VerbaClipboard;
    const serialize = Clipboard && (Clipboard.serializeSelectionHtmlFromString || Clipboard.serialize);
    let html;
    if (serialize) {
      html = serialize(rootEl.innerHTML, { entire: true });
    } else {
      html = rootEl.innerHTML;
    }
    const text = rootEl.innerText;
    try {
      const item = new ClipboardItem({
        'text/html':  new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
    } catch (e) {
      // Fallback — execCommand
      const sel = window.getSelection(); sel.removeAllRanges();
      const range = document.createRange(); range.selectNodeContents(rootEl);
      sel.addRange(range); document.execCommand('copy'); sel.removeAllRanges();
    }
  }
  global.FilesClipboard = { copyAll };
})(window);
