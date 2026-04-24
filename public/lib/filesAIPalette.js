// public/lib/filesAIPalette.js
(function(global){
  'use strict';
  const API = global.API;
  let currentQuill = null;
  let paletteEl = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  }

  function close() {
    if (paletteEl) { paletteEl.remove(); paletteEl = null; }
    document.removeEventListener('click', outsideClose, true);
  }
  function outsideClose(e) {
    if (paletteEl && !paletteEl.contains(e.target)) close();
  }

  function nearestHeadings(quill) {
    const range = quill.getSelection();
    if (!range) return {};
    const blocks = Array.from(quill.root.children);
    let idx = blocks.length - 1;
    let offset = 0;
    for (let i = 0; i < blocks.length; i++) {
      const len = (blocks[i].textContent || '').length + 1;
      if (offset + len > range.index) { idx = i; break; }
      offset += len;
    }
    const result = {};
    for (let i = idx; i >= 0; i--) {
      const t = blocks[i].tagName && blocks[i].tagName.toLowerCase();
      if (t === 'h1' && !result.h1) result.h1 = blocks[i].textContent;
      if (t === 'h2' && !result.h2) result.h2 = blocks[i].textContent;
      if (t === 'h3' && !result.h3) result.h3 = blocks[i].textContent;
      if (result.h1 && result.h2 && result.h3) break;
    }
    return result;
  }

  function anchorPalette(insertIndex) {
    const sel = insertIndex != null ? { index: insertIndex } : currentQuill.getSelection(true);
    const bounds = currentQuill.getBounds(sel.index);
    const editorRect = currentQuill.root.getBoundingClientRect();
    paletteEl.style.left = Math.max(16, editorRect.left + bounds.left) + 'px';
    paletteEl.style.top = (editorRect.top + bounds.top + 24 + window.scrollY) + 'px';
  }

  function openMenu() {
    close();
    const sel = currentQuill.getSelection(true);
    paletteEl = document.createElement('div');
    paletteEl.className = 'files-palette';
    paletteEl.innerHTML = `
      <div class="results">
        <div class="result" data-k="card">Insert card</div>
        <div class="result" data-k="block">Generate block</div>
        <div class="result" data-k="analytic">Generate analytic</div>
        <div class="result" data-k="h1">Insert heading: Pocket (H1)</div>
        <div class="result" data-k="h2">Insert heading: Hat (H2)</div>
        <div class="result" data-k="h3">Insert heading: Block (H3)</div>
        <div class="result" data-k="h4">Insert heading: Tag (H4)</div>
      </div>`;
    document.body.appendChild(paletteEl);
    anchorPalette(sel.index);
    paletteEl.querySelectorAll('.result').forEach(r => {
      r.addEventListener('click', () => {
        const k = r.dataset.k;
        if (k === 'card' || k === 'block' || k === 'analytic') openMode(k);
        else if (/^h[1-4]$/.test(k)) {
          const level = Number(k[1]);
          currentQuill.format('header', level);
          close();
        }
      });
    });
    setTimeout(() => document.addEventListener('click', outsideClose, true), 0);
  }

  function openMode(kind) {
    close();
    const sel = currentQuill.getSelection(true);
    const insertAt = sel.index;
    paletteEl = document.createElement('div');
    paletteEl.className = 'files-palette';
    const label = { card:'Insert card', block:'Generate block', analytic:'Generate analytic' }[kind];
    const placeholder = kind === 'card' ? 'Search your library…' : 'Describe what you want…';
    paletteEl.innerHTML = `
      <div style="font:600 11px/1 var(--font-sans);color:#888;margin-bottom:6px">${label}</div>
      <input type="text" placeholder="${placeholder}"/>
      <div class="results"></div>
    `;
    document.body.appendChild(paletteEl);
    anchorPalette(insertAt);
    const input = paletteEl.querySelector('input');
    const results = paletteEl.querySelector('.results');
    input.focus();

    let searchTimer = null;
    if (kind === 'card') {
      input.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {
          if (!input.value.trim()) { results.innerHTML = ''; return; }
          try {
            const { cards } = await API.docsAiCardSearch({ q: input.value, k: 10 });
            renderCardResults(results, cards || [], insertAt);
          } catch (e) {
            results.innerHTML = `<div class="result" style="color:#c33">Search failed: ${escapeHtml(e.message)}</div>`;
          }
        }, 200);
      });
    }

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (kind === 'card') {
        const first = results.querySelector('.result');
        if (first) first.click();
        return;
      }
      if (kind === 'block') {
        results.innerHTML = '<div class="result">Generating block…</div>';
        const headings = nearestHeadings(currentQuill);
        try {
          const out = await API.docsAiBlock({ intent: input.value, headings });
          insertBlock(out, insertAt);
        } catch (err) {
          results.innerHTML = `<div class="result" style="color:#c33">Failed: ${escapeHtml(err.message)}</div>`;
          return;
        }
        close();
        return;
      }
      if (kind === 'analytic') {
        results.innerHTML = '<div class="result">Writing analytic…</div>';
        const headings = nearestHeadings(currentQuill);
        try {
          const out = await API.docsAiAnalytic({ intent: input.value, headings });
          const text = (out && out.text) ? String(out.text) : '';
          currentQuill.insertText(insertAt, '\n' + text + '\n', 'user');
        } catch (err) {
          results.innerHTML = `<div class="result" style="color:#c33">Failed: ${escapeHtml(err.message)}</div>`;
          return;
        }
        close();
        return;
      }
    });
    setTimeout(() => document.addEventListener('click', outsideClose, true), 0);
  }

  function renderCardResults(host, cards, insertAt) {
    host.innerHTML = '';
    if (!cards.length) {
      host.innerHTML = '<div class="result" style="color:#888">No matches.</div>';
      return;
    }
    cards.forEach(c => {
      const row = document.createElement('div');
      row.className = 'result';
      row.innerHTML = `
        <div style="font:700 12px/1.2 var(--font-sans)">${escapeHtml(c.tag || '')}</div>
        <div style="font:400 11px/1.2 var(--font-sans);color:#666">${escapeHtml(c.shortCite || '')}</div>
        <div style="font:400 11px/1.3 var(--font-sans);color:#555;margin-top:3px">${escapeHtml((c.body_plain || '').slice(0, 160))}…</div>
      `;
      row.addEventListener('click', () => {
        insertCard(c, insertAt);
        close();
      });
      host.appendChild(row);
    });
  }

  function cardHtml(c, tagOverride) {
    const tag = escapeHtml(tagOverride || c.tag || '');
    const cite = escapeHtml(c.shortCite || '');
    const body = escapeHtml(c.body_plain || '');
    return `<h4>${tag}</h4><p><b>${cite}</b></p><p>${body}</p>`;
  }

  function insertCard(card, at) {
    currentQuill.insertEmbed(at, 'card-embed', { id: card.id, html: cardHtml(card) }, 'user');
    currentQuill.setSelection(at + 1, 0);
  }

  function insertBlock(out, at) {
    let pos = at;
    if (out.analyticBefore) {
      currentQuill.insertText(pos, out.analyticBefore + '\n', 'user');
      pos += out.analyticBefore.length + 1;
    }
    const allCards = out.candidateCards || [];
    const pickedIds = out.pickedCardIds || [];
    const picked = pickedIds.map(id => allCards.find(c => c.id === id)).filter(Boolean);
    const glue = out.glueBetween || [];
    picked.forEach((c, i) => {
      currentQuill.insertEmbed(pos, 'card-embed', { id: c.id, html: cardHtml(c, out.tag) }, 'user');
      pos += 1;
      if (glue[i]) {
        currentQuill.insertText(pos, glue[i] + '\n', 'user');
        pos += glue[i].length + 1;
      }
    });
    if (out.analyticAfter) {
      currentQuill.insertText(pos, out.analyticAfter + '\n', 'user');
      pos += out.analyticAfter.length + 1;
    }
    // Swap strip (Task 17 will extend)
    if (global.FilesSwapStrip && global.FilesSwapStrip.render) {
      global.FilesSwapStrip.render(currentQuill, allCards, picked.map(c => c.id));
    }
  }

  function attach(quill) {
    currentQuill = quill;
    quill.keyboard.addBinding({ key: 'K', ctrlKey: true }, () => { openMenu(); return false; });
    quill.keyboard.addBinding({ key: 'K', metaKey: true }, () => { openMenu(); return false; });
  }

  global.FilesAIPalette = { attach, openMenu };
})(window);
