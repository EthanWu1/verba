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
  }

  global.ChatApp = { show };
})(window);
