// public/lib/chatStream.js
(function(global){
  'use strict';
  async function stream(threadId, content, { onStart, onToken, onDone, onError, extra }) {
    const body = Object.assign({ content }, extra || {});
    const res = await fetch(`/api/chat/threads/${encodeURIComponent(threadId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('text/event-stream')) {
      const j = await res.json();
      if (onStart) onStart(j.userMessage || {});
      if (onDone) onDone({ assistantMessage: j.assistantMessage });
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const ev = buf.slice(0, idx); buf = buf.slice(idx + 2);
        let event = 'message', data = '';
        ev.split('\n').forEach(l => {
          if (l.startsWith('event: ')) event = l.slice(7).trim();
          else if (l.startsWith('data: ')) data += l.slice(6);
        });
        let payload = {}; try { payload = JSON.parse(data); } catch {}
        if (event === 'start' && onStart) onStart(payload);
        else if (event === 'token' && onToken) onToken(payload.t || '');
        else if (event === 'done' && onDone) onDone(payload);
        else if (event === 'error' && onError) onError(payload);
      }
    }
  }
  global.ChatStream = { stream };
})(window);
