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
    const threadTitle = (messages[0]?.content || 'Thread').slice(0, 60);
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
      <span class="icon">📄</span>
      <div class="meta">
        <div class="tag">${escapeHtml(m.blockJson.tag || '(block)')}</div>
        <div class="cite">${escapeHtml(summarizeCites(m.blockJson))}</div>
      </div>
      <span>Open ▸</span>`;
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

  async function send() {
    const text = inputEl.value.trim(); if (!text || !currentThreadId) return;
    inputEl.value = ''; autogrow();
    renderMessage({ role:'user', content:text, command:null });
    const asstEl = document.createElement('div');
    asstEl.className = 'chat-msg assistant';
    msgsEl.appendChild(asstEl);
    scrollBottom();

    let streamed = '';
    await global.ChatStream.stream(currentThreadId, text, {
      onStart: () => {},
      onToken: (t) => { streamed += t; asstEl.textContent = streamed; scrollBottom(); },
      onDone: async (payload) => {
        if (payload && payload.assistantMessage && payload.assistantMessage.command === '/block') {
          asstEl.remove();
          renderMessage(payload.assistantMessage);
          scrollBottom();
        }
      },
      onError: (e) => { asstEl.textContent = '⚠ ' + (e.message || 'error'); },
    });
  }

  function scrollBottom() { msgsEl.scrollTop = msgsEl.scrollHeight; }

  global.ChatThread = { init, openThread };
})(window);
