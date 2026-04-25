(function(global){
  'use strict';
  let initialized = false;

  async function show() {
    if (!initialized) { init(); initialized = true; }
    const { threads } = await global.API.chat.listThreads();
    if (threads.length === 0) {
      const { thread } = await global.API.chat.createThread('New thread');
      global.ChatThread.openThread(thread.id);
    } else {
      global.ChatThread.openThread(threads[0].id);
    }
  }

  function init() {
    global.ChatThread.init();
    document.getElementById('chat-btn-history').addEventListener('click', (e) => global.ChatHistory.open(e.currentTarget));
    document.getElementById('chat-btn-context').addEventListener('click', (e) => global.ChatContext.open(e.currentTarget));
    document.getElementById('chat-btn-new').addEventListener('click', async () => {
      const { thread } = await global.API.chat.createThread('New thread');
      global.ChatThread.openThread(thread.id);
    });
    initComposer();
  }

  function initComposer() {
    const input = document.getElementById('chat-input');
    const composer = input && input.closest('.chat-composer');
    if (!input || !composer) return;
    const autoresize = () => {
      input.style.height = 'auto';
      const next = Math.min(200, Math.max(60, input.scrollHeight));
      input.style.height = next + 'px';
      composer.classList.toggle('has-content', input.value.trim().length > 0);
    };
    input.addEventListener('input', autoresize);
    autoresize();
    document.querySelectorAll('.chat-suggested .chat-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const prefill = btn.dataset.prefill || '';
        input.value = prefill;
        input.focus();
        const end = input.value.length;
        try { input.setSelectionRange(end, end); } catch (_) {}
        autoresize();
      });
    });
  }

  global.ChatApp = { show };
})(window);
