// public/lib/chatSplitView.js
(function(global){
  'use strict';
  let openCard = null;

  // Renders card body_markdown into safe HTML preserving the highlighter's
  // markup (<u>...</u> = underline, **...** = bold, ==...== = highlight).
  // Escapes everything else first so unrelated HTML can't sneak through.
  function renderCardMarkdown(md) {
    let s = String(md || '');
    // Escape ALL HTML first
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Reinstate the small whitelist Verbatim emits: <u>...</u>
    s = s.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, '<u>$1</u>');
    // ==highlight==  → <mark>
    s = s.replace(/==([\s\S]+?)==/g, '<mark>$1</mark>');
    // **bold** → <strong>  (allow nested <u> inside)
    s = s.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    // Paragraph splitting: blank-line separates, single \n = <br>
    return s.split(/\n{2,}/).map(p => {
      const t = p.trim();
      if (!t) return '';
      return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');
  }

  // Render ANALYTIC glue text (analyticBefore/glueBetween/analyticAfter).
  // Allows the same markdown set as cards so the LLM can emit <u>/**/== if
  // the corpus norm calls for it. Also splits paragraphs on blank lines.
  function renderGlue(text) {
    if (!text) return '';
    return renderCardMarkdown(text);
  }

  function renderBlockHtml(block) {
    const picked = (block.pickedCardIds || []).map(id => (block.candidateCards || []).find(c => c.id === id)).filter(Boolean);
    const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
    const parts = [];
    parts.push(`<h4 style="font:700 13pt/1.3 Calibri">${esc(block.tag || (picked[0] && picked[0].tag) || '(block)')}</h4>`);
    if (block.analyticBefore) parts.push(renderGlue(block.analyticBefore));
    picked.forEach((c, i) => {
      parts.push(`<p class="cite"><b>${esc(c.shortCite || '')}</b></p>`);
      // Use body_markdown (full <u>/**/=*= formatting). Fall back to
      // body_plain for legacy cards that haven't been re-indexed.
      parts.push(`<div class="card-body">${renderCardMarkdown(c.body_markdown || c.body_plain || '')}</div>`);
      if ((block.glueBetween || [])[i]) parts.push(renderGlue(block.glueBetween[i]));
    });
    if (block.analyticAfter) parts.push(renderGlue(block.analyticAfter));
    return parts.join('\n');
  }

  // ── Resize handle + width persistence ──────────────────────────────
  // Default: 580px (was 380). Wider so the formatted card body and analytics
  // breathe. User can drag the left edge to resize (240px..min(900, 90vw)).
  // Width persists per-browser via localStorage.
  const STORAGE_KEY = 'verba.chatSplit.width';
  const MIN_W = 240;
  const DEFAULT_W = 580;
  function maxW() { return Math.min(900, Math.round(window.innerWidth * 0.9)); }
  function loadWidth() {
    try {
      const n = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
      if (n >= MIN_W && n <= 1200) return n;
    } catch {}
    return DEFAULT_W;
  }
  function applyWidth(pane, px) {
    const clamped = Math.max(MIN_W, Math.min(maxW(), px));
    pane.style.width = clamped + 'px';
    // Match offset on the chat-main padding so messages don't underlap.
    document.documentElement.style.setProperty('--chat-split-width', clamped + 'px');
  }
  function ensureResizeHandle(pane) {
    if (pane.querySelector('.chat-split-resize')) return;
    const grip = document.createElement('div');
    grip.className = 'chat-split-resize';
    grip.title = 'Drag to resize';
    pane.prepend(grip);
    let dragging = false, startX = 0, startW = 0;
    grip.addEventListener('mousedown', (e) => {
      dragging = true;
      startX = e.clientX;
      startW = pane.getBoundingClientRect().width;
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = startX - e.clientX; // dragging LEFT widens the right-anchored pane
      applyWidth(pane, startW + dx);
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem(STORAGE_KEY, String(parseInt(pane.style.width, 10) || DEFAULT_W)); } catch {}
    });
  }

  function toggle(cardEl, block) {
    const pane = document.getElementById('chat-split');
    if (openCard === cardEl) { close(); return; }
    openCard = cardEl;
    ensureResizeHandle(pane);
    applyWidth(pane, loadWidth());
    document.querySelectorAll('.chat-file-card').forEach(c => c.classList.toggle('is-open', c === cardEl));
    document.getElementById('chat-split-body').innerHTML = renderBlockHtml(block);
    document.getElementById('chat-split-title').textContent = (block.tag || 'Block').slice(0, 60);
    pane.hidden = false;
    const copyBtn = document.getElementById('chat-split-copy');
    copyBtn.__wired = false;
    copyBtn.onclick = null;
    const doCopy = async () => {
      const body = document.getElementById('chat-split-body');
      const html = (global.Clipboard && global.Clipboard.serializeSelectionHtmlFromString)
        ? global.Clipboard.serializeSelectionHtmlFromString(body.innerHTML, { entire: true })
        : body.innerHTML;
      navigator.clipboard.writeText(body.innerText);
      try {
        const item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([body.innerText], { type: 'text/plain' }),
        });
        await navigator.clipboard.write([item]);
      } catch {}
    };
    if (typeof global.wireCopyBtn === 'function') {
      global.wireCopyBtn(copyBtn, doCopy);
    } else {
      // Fallback: direct binding without animation if helper isn't loaded yet.
      copyBtn.addEventListener('click', () => {
        doCopy();
        copyBtn.classList.add('copied');
        setTimeout(() => copyBtn.classList.remove('copied'), 1600);
      });
    }
    document.getElementById('chat-split-close').onclick = close;
  }
  function close() {
    const pane = document.getElementById('chat-split'); pane.hidden = true;
    if (openCard) openCard.classList.remove('is-open');
    openCard = null;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  global.ChatSplitView = { toggle, close };
})(window);
