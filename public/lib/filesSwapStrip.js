// public/lib/filesSwapStrip.js
(function(global){
  'use strict';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  }

  function cardHtml(c) {
    const tag = escapeHtml(c.tag || '');
    const cite = escapeHtml(c.shortCite || '');
    const body = escapeHtml(c.body_plain || '');
    return `<h4>${tag}</h4><p><b>${cite}</b></p><p>${body}</p>`;
  }

  let currentStrip = null;

  function render(quill, allCards, pickedIds) {
    dismiss();
    const alts = (allCards || []).filter(c => !(pickedIds || []).includes(c.id));
    if (!alts.length) return;

    const strip = document.createElement('div');
    strip.className = 'files-swap-strip';
    const label = document.createElement('span');
    label.style.cssText = 'font:600 11px var(--font-sans);color:#666';
    label.textContent = 'More like this:';
    strip.appendChild(label);

    alts.slice(0, 5).forEach(c => {
      const pill = document.createElement('button');
      pill.className = 'files-swap-pill';
      pill.textContent = c.shortCite || c.tag || '(card)';
      pill.title = c.tag || '';
      pill.addEventListener('click', () => {
        const sel = quill.getSelection(true);
        const at = sel ? sel.index : quill.getLength();
        quill.insertEmbed(at, 'card-embed', { id: c.id, html: cardHtml(c) }, 'user');
      });
      strip.appendChild(pill);
    });

    const close = document.createElement('button');
    close.className = 'files-swap-pill';
    close.textContent = '✕';
    close.title = 'Dismiss strip';
    close.addEventListener('click', dismiss);
    strip.appendChild(close);

    const host = quill.root.parentElement;
    if (host) {
      host.insertBefore(strip, quill.root);
    }
    currentStrip = strip;
    setTimeout(() => { if (currentStrip === strip) dismiss(); }, 90000);
  }

  function dismiss() {
    if (currentStrip) { currentStrip.remove(); currentStrip = null; }
  }

  global.FilesSwapStrip = { render, dismiss };
})(window);
