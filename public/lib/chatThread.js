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

  // Minimal but solid markdown → HTML for chat replies. Handles bold, italic,
  // headings (# ##), inline code, code fences, bullet/numbered lists, blockquotes,
  // links, paragraphs. Escapes HTML first to prevent injection.
  function renderMarkdown(src) {
    let s = String(src || '');
    // Escape HTML
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Code fences ```lang\ncode\n```
    s = s.replace(/```([a-z0-9_+-]*)?\n([\s\S]*?)```/gi, (_, lang, code) =>
      `<pre><code${lang ? ` class="lang-${lang}"` : ''}>${code.replace(/\n$/, '')}</code></pre>`);
    // Inline code `x`
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // Headings (line-leading)
    s = s.replace(/^###### (.+)$/gm, '<h6>$1</h6>')
         .replace(/^##### (.+)$/gm, '<h5>$1</h5>')
         .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
         .replace(/^### (.+)$/gm, '<h3>$1</h3>')
         .replace(/^## (.+)$/gm, '<h2>$1</h2>')
         .replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // Bold **x**
    s = s.replace(/\*\*([^*\n][^*]*?)\*\*/g, '<strong>$1</strong>');
    // Italic *x* (must come AFTER bold; avoid eating the asterisk in lists)
    s = s.replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>');
    // Links [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Bullet / numbered lists — group consecutive list lines
    s = s.replace(/(?:^[ \t]*(?:[-*+] |\d+\. ).+(?:\n|$))+/gm, (block) => {
      const items = block.trim().split('\n').map(line =>
        '<li>' + line.replace(/^[ \t]*(?:[-*+] |\d+\. )/, '') + '</li>'
      ).join('');
      const isOrdered = /^\s*\d+\. /.test(block);
      return `<${isOrdered ? 'ol' : 'ul'}>${items}</${isOrdered ? 'ol' : 'ul'}>`;
    });
    // Blockquotes
    s = s.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    // Paragraphs: split on double newlines, wrap if not already a block element
    s = s.split(/\n{2,}/).map(part => {
      const t = part.trim();
      if (!t) return '';
      if (/^<(h\d|ul|ol|pre|blockquote)/.test(t)) return t;
      return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');
    return s;
  }

  function renderMessage(m) {
    if (m.command === '/block' && m.blockJson) {
      msgsEl.appendChild(blockCard(m));
      return;
    }
    const el = document.createElement('div');
    el.className = 'chat-msg ' + m.role;
    if (m.role === 'assistant') {
      el.innerHTML = renderMarkdown(m.content || '');
    } else {
      // User messages stay as plain text — no markdown rendering on input.
      el.textContent = m.content;
    }
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

  let creatingThread = null; // in-flight createThread Promise — blocks duplicate sends.
  async function send() {
    const text = inputEl.value.trim(); if (!text) return;
    const wasFirstMessage = !currentThreadId;
    // Lazy-create the thread on first message so we don't pile up empty "New thread" rows.
    // Guard with `creatingThread` so a double-click during the createThread
    // round-trip doesn't fire two POSTs (which used to create two threads
    // with the same title and look like duplicates in the picker).
    if (!currentThreadId) {
      if (!creatingThread) {
        const title = text.slice(0, 60);
        creatingThread = API.chat.createThread(title)
          .then(({ thread }) => {
            currentThreadId = thread.id;
            document.getElementById('chat-thread-title').textContent = title;
          })
          .finally(() => { creatingThread = null; });
      }
      await creatingThread;
    }
    inputEl.value = ''; autogrow();
    renderMessage({ role:'user', content:text, command:null });
    const asstEl = document.createElement('div');
    asstEl.className = 'chat-msg assistant pending';
    asstEl.innerHTML = '<span class="chat-label">Assistant</span><div class="thinking"><span class="thinking-dot"></span><span class="thinking-text"></span></div>';
    msgsEl.appendChild(asstEl);
    scrollBottom();

    // Rotating "thinking" messages while waiting for first token. Replaces a
    // generic "Thinking…" with debate-flavored variations that swap every 1.8s.
    const THINKING_LINES = [
      'Pulling threads of the argument',
      'Stress-testing the warrant',
      'Hunting for a tighter answer',
      'Walking through the logic',
      'Weighing the impact calculus',
      'Looking up source paragraphs',
      'Sorting offense from defense',
      'Building the chain',
      'Checking for turn-around risk',
      'Refining the response',
      'Tracing the link story',
      'Drafting carefully',
    ];
    const thinkingTextEl = asstEl.querySelector('.thinking-text');
    let thinkingIdx = Math.floor(Math.random() * THINKING_LINES.length);
    if (thinkingTextEl) thinkingTextEl.textContent = THINKING_LINES[thinkingIdx];
    const thinkingTimer = setInterval(() => {
      if (!asstEl.classList.contains('pending')) { clearInterval(thinkingTimer); return; }
      thinkingIdx = (thinkingIdx + 1 + Math.floor(Math.random() * 3)) % THINKING_LINES.length;
      if (thinkingTextEl) thinkingTextEl.textContent = THINKING_LINES[thinkingIdx];
    }, 1800);

    // Smooth typewriter: SSE tokens often arrive in chunks (5–80 chars). Buffer
    // them and reveal at a steady rate via requestAnimationFrame so the UI
    // feels like character-by-character typing instead of jumpy bursts.
    let streamed = '';
    let revealed = '';
    let revealRaf = null;
    let bodyEl = null;
    const REVEAL_CHARS_PER_FRAME = 3;
    const ensureBody = () => {
      if (bodyEl) return bodyEl;
      asstEl.classList.remove('pending');
      asstEl.innerHTML = '<span class="chat-label">Assistant</span><div class="chat-msg-body"></div>';
      bodyEl = asstEl.querySelector('.chat-msg-body');
      return bodyEl;
    };
    const tickReveal = () => {
      revealRaf = null;
      if (revealed.length >= streamed.length) return;
      revealed = streamed.slice(0, revealed.length + REVEAL_CHARS_PER_FRAME);
      ensureBody().innerHTML = renderMarkdown(revealed);
      scrollBottom();
      if (revealed.length < streamed.length) revealRaf = requestAnimationFrame(tickReveal);
    };

    const contextIds = (global.ChatContext && global.ChatContext.getSelectedIds)
      ? Array.from(global.ChatContext.getSelectedIds())
      : [];
    await global.ChatStream.stream(currentThreadId, text, {
      extra: { contextIds },
      onStart: () => {},
      onToken: (t) => {
        streamed += t;
        if (!revealRaf) revealRaf = requestAnimationFrame(tickReveal);
      },
      onDone: async (payload) => {
        clearInterval(thinkingTimer);
        // Flush any remaining unrevealed text immediately so the user sees the full reply.
        if (revealRaf) { cancelAnimationFrame(revealRaf); revealRaf = null; }
        revealed = streamed;
        if (streamed) {
          ensureBody().innerHTML = renderMarkdown(streamed);
          scrollBottom();
        }
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
        clearInterval(thinkingTimer);
        if (revealRaf) { cancelAnimationFrame(revealRaf); revealRaf = null; }
        asstEl.classList.remove('pending');
        if (e && e.status === 429) {
          asstEl.innerHTML = '<span class="chat-label">Assistant</span><div class="chat-msg-body">⚠ Free plan: 20 messages / month reached. Upgrade to keep chatting.</div>';
          if (typeof global.refreshUsage === 'function') global.refreshUsage();
        } else {
          asstEl.innerHTML = '<span class="chat-label">Assistant</span><div class="chat-msg-body">⚠ ' + (e.message || 'error') + '</div>';
        }
      },
    });
  }

  function scrollBottom() { msgsEl.scrollTop = msgsEl.scrollHeight; }

  global.ChatThread = { init, openThread, clear, currentId: () => currentThreadId };
})(window);
