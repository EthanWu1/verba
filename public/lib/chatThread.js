// public/lib/chatThread.js
(function(global){
  'use strict';
  const API = global.API;
  let currentThreadId = null;
  let msgsEl, inputEl;

  function init() {
    msgsEl = document.getElementById('chat-messages');
    inputEl = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    sendBtn.addEventListener('click', send);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    inputEl.addEventListener('input', autogrow);
  }
  function autogrow() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(160, inputEl.scrollHeight) + 'px';
  }

  async function openThread(id) {
    currentThreadId = id;
    document.getElementById('chat-thread-title').textContent = '';
    msgsEl.innerHTML = '';
    const { messages } = await API.chat.listMessages(id);
    messages.forEach(renderMessage);
    scrollBottom();
    const threadTitle = (messages[0]?.content || '').slice(0, 60);
    document.getElementById('chat-thread-title').textContent = threadTitle;
  }

  function renderMessage(m) {
    if (m.command === '/block' && m.blockJson) {
      msgsEl.appendChild(blockCard(m));
      return;
    }
    const el = document.createElement('div');
    el.className = 'chat-msg ' + m.role;
    el.textContent = m.content;
    msgsEl.appendChild(el);
  }

  function blockCard(m) {
    const card = document.createElement('div');
    card.className = 'chat-file-card';
    card.innerHTML = `
      <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="6" y="6" width="14" height="14" rx="1.5"/><path d="M16 6V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h2"/></svg></span>
      <span class="kind">Block</span>
      <div class="meta">
        <div class="tag">${escapeHtml(m.blockJson.tag || '(block)')}</div>
        <div class="cite">${escapeHtml(summarizeCites(m.blockJson))}</div>
      </div>
      <span>›</span>`;
    card.addEventListener('click', () => {
      if (global.ChatSplitView && global.ChatSplitView.toggle) {
        global.ChatSplitView.toggle(card, m.blockJson);
      }
    });
    return card;
  }
  function summarizeCites(b) {
    const picked = (b.pickedCardIds || []).slice(0, 2);
    const ccs = (b.candidateCards || []).filter(c => picked.includes(c.id));
    return ccs.map(c => c.shortCite).filter(Boolean).join(' · ') || 'Click to view block';
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

  function clear() {
    currentThreadId = null;
    if (msgsEl) msgsEl.innerHTML = '';
    const titleEl = document.getElementById('chat-thread-title');
    if (titleEl) titleEl.textContent = '';
  }

  async function refreshThreadTitle() {
    if (!currentThreadId) return;
    try {
      const { threads } = await API.chat.listThreads();
      const t = (threads || []).find(t => t.id === currentThreadId);
      if (t && t.title) {
        const titleEl = document.getElementById('chat-thread-title');
        if (titleEl) titleEl.textContent = t.title;
      }
    } catch {}
  }

  async function send() {
    const text = inputEl.value.trim(); if (!text) return;
    const wasFirstMessage = !currentThreadId;
    // Lazy-create the thread on first message so we don't pile up empty "New thread" rows.
    if (!currentThreadId) {
      const title = text.slice(0, 60);
      const { thread } = await API.chat.createThread(title);
      currentThreadId = thread.id;
      document.getElementById('chat-thread-title').textContent = title;
    }
    inputEl.value = ''; autogrow();
    renderMessage({ role:'user', content:text, command:null });
    const asstEl = document.createElement('div');
    asstEl.className = 'chat-msg assistant';
    msgsEl.appendChild(asstEl);
    scrollBottom();

    let streamed = '';
    const contextIds = (global.ChatContext && global.ChatContext.getSelectedIds)
      ? Array.from(global.ChatContext.getSelectedIds())
      : [];
    await global.ChatStream.stream(currentThreadId, text, {
      extra: { contextIds },
      onStart: () => {},
      onToken: (t) => { streamed += t; asstEl.textContent = streamed; scrollBottom(); },
      onDone: async (payload) => {
        if (payload && payload.assistantMessage && payload.assistantMessage.command === '/block') {
          asstEl.remove();
          renderMessage(payload.assistantMessage);
          scrollBottom();
        }
        // Server auto-renames the thread after the first user message via the
        // LLM. Pull the new title so the topbar reflects it without a refresh.
        if (wasFirstMessage) {
          // Slight delay so the rename round-trip has time to land.
          setTimeout(refreshThreadTitle, 800);
        }
        // Refresh free-plan usage indicator after each successful send.
        if (typeof global.refreshUsage === 'function') global.refreshUsage();
      },
      onError: (e) => {
        if (e && e.status === 429) {
          asstEl.textContent = '⚠ Free plan: 20 messages / month reached. Upgrade to keep chatting.';
          if (typeof global.refreshUsage === 'function') global.refreshUsage();
        } else {
          asstEl.textContent = '⚠ ' + (e.message || 'error');
        }
      },
    });
  }

  function scrollBottom() { msgsEl.scrollTop = msgsEl.scrollHeight; }

  global.ChatThread = { init, openThread, clear };
})(window);
