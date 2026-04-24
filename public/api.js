/* Verba API client — wraps every /api route used by the app. */
(function (global) {
  'use strict';

  async function jsonFetch(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const res = await fetch(path, { credentials: 'include', ...opts, headers });
    const txt = await res.text();
    let data;
    try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
    if (!res.ok) {
      const err = new Error((data && data.error) || res.statusText || ('HTTP ' + res.status));
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  const api = {
    health: () => jsonFetch('/api/health'),

    // --- AI / card cutter ---
    cutCard: (payload) => jsonFetch('/api/cut-card', { method: 'POST', body: JSON.stringify(payload) }),
    editCard: (payload) => jsonFetch('/api/edit-card', { method: 'POST', body: JSON.stringify(payload) }),
    research: (payload) => jsonFetch('/api/research', { method: 'POST', body: JSON.stringify(payload) }),
    researchSource: (payload) => jsonFetch('/api/research-source', { method: 'POST', body: JSON.stringify(payload) }),
    chatLibrary: (payload) => jsonFetch('/api/chat-library', { method: 'POST', body: JSON.stringify(payload) }),
    chatLibrarySummary: (payload) => jsonFetch('/api/chat-library-summary', { method: 'POST', body: JSON.stringify(payload) }),

    // --- chat ---
    chat: (payload) => jsonFetch('/api/chat', { method: 'POST', body: JSON.stringify(payload) }),

    // --- library ---
    libraryDashboard: (limit = 12) => jsonFetch(`/api/library/dashboard?limit=${limit}`),
    librarySearch: (q, limit = 50) => jsonFetch(`/api/library/search?q=${encodeURIComponent(q)}&limit=${limit}`),
    librarySemantic: (q, k = 25) => jsonFetch(`/api/library/semantic-search?q=${encodeURIComponent(q)}&k=${k}`),
    libraryCards: (params = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') qs.set(k, String(v)); });
      return jsonFetch('/api/library/cards?' + qs.toString());
    },
    libraryCard: (id) => jsonFetch(`/api/library/cards/${encodeURIComponent(id)}`),
    libraryAnalytics: () => jsonFetch('/api/library/analytics'),

    // --- scrape ---
    scrape: (url, inferQuals = true) => jsonFetch('/api/scrape', { method: 'POST', body: JSON.stringify({ url, inferQuals }) }),

    // --- import ---
    zipPreview: (zipPath, sampleSize = 25) => jsonFetch('/api/import/zip-preview', { method: 'POST', body: JSON.stringify({ zipPath, sampleSize }) }),
    zipIngest: (zipPath, maxDocs) => jsonFetch('/api/import/zip-ingest', { method: 'POST', body: JSON.stringify({ zipPath, maxDocs }) }),
    docxUpload: async (arrayBuffer, label = 'manual-upload') => {
      const res = await fetch('/api/import/docx-upload?label=' + encodeURIComponent(label), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: arrayBuffer,
      });
      if (!res.ok) throw new Error((await res.text()) || 'docx upload failed');
      return res.json();
    },

    // --- export (returns Blob for download) ---
    exportDocx: async (card) => {
      const res = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card) });
      if (!res.ok) throw new Error((await res.text()) || 'export failed');
      const blob = await res.blob();
      const filename = (res.headers.get('content-disposition') || '').match(/filename="?([^";]+)/)?.[1] || 'card.docx';
      return { blob, filename };
    },

    exportProject: async (projectId) => {
      const res = await fetch('/api/export/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }) });
      if (!res.ok) throw new Error((await res.text()) || 'project export failed');
      const blob = await res.blob();
      const filename = (res.headers.get('content-disposition') || '').match(/filename="?([^";]+)/)?.[1] || 'project.docx';
      return { blob, filename };
    },

    // --- auth ---
    auth: {
      signup: (email, password, name) => jsonFetch('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
      login:  (email, password)       => jsonFetch('/api/auth/login',  { method: 'POST', body: JSON.stringify({ email, password }) }),
      logout: ()                      => jsonFetch('/api/auth/logout', { method: 'POST' }),
      me:     ()                      => jsonFetch('/api/auth/me'),
      google: (idToken)               => jsonFetch('/api/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) }),
      usage:  ()                      => jsonFetch('/api/auth/usage'),
      forgot: (email)                 => jsonFetch('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
      reset:  (token, password)       => jsonFetch('/api/auth/reset',  { method: 'POST', body: JSON.stringify({ token, password }) }),
      updateProfile:    (patch)    => jsonFetch('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(patch) }),
      listSessions:     ()         => jsonFetch('/api/auth/sessions'),
      revokeSession:    (id)       => jsonFetch('/api/auth/sessions/' + encodeURIComponent(id), { method: 'DELETE' }),
      revokeAllSessions:()         => jsonFetch('/api/auth/sessions', { method: 'DELETE' }),
    },

    // --- contentions ---
    contentions: (topic) => jsonFetch('/api/contentions' + (topic ? `?topic=${encodeURIComponent(topic)}` : '')),
    createContention: (payload) => jsonFetch('/api/contentions', { method: 'POST', body: JSON.stringify(payload) }),
    deleteContention: (id) => jsonFetch('/api/contentions/' + encodeURIComponent(id), { method: 'DELETE' }),

    // --- projects (backend route added) ---
    projects: () => jsonFetch('/api/projects'),
    createProject: (name, color) => jsonFetch('/api/projects', { method: 'POST', body: JSON.stringify({ name, color }) }),
    renameProject: (id, patch) => jsonFetch('/api/projects/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(typeof patch === 'string' ? { name: patch } : (patch || {})) }),
    deleteProject: (id) => jsonFetch('/api/projects/' + encodeURIComponent(id), { method: 'DELETE' }),
    addProjectCard: (id, card) => jsonFetch('/api/projects/' + encodeURIComponent(id) + '/cards', { method: 'POST', body: JSON.stringify({ card }) }),
    removeProjectCard: (id, cardId) => jsonFetch('/api/projects/' + encodeURIComponent(id) + '/cards/' + encodeURIComponent(cardId), { method: 'DELETE' }),

    history: {
      async get() { try { return (await jsonFetch('/api/history')).items || []; } catch { return []; } },
      async push(entry) { return jsonFetch('/api/history', { method: 'POST', body: JSON.stringify({ entry }) }); },
      async clear() { return jsonFetch('/api/history', { method: 'DELETE' }); },
    },

    mine: {
      async get() { try { return (await jsonFetch('/api/mine')).items || []; } catch { return []; } },
      async save(card) {
        const res = await jsonFetch('/api/mine', { method: 'POST', body: JSON.stringify({ card }) });
        return { card: res.card, duplicate: !!res.duplicate };
      },
      async remove(id) { return jsonFetch('/api/mine/' + encodeURIComponent(id), { method: 'DELETE' }); },
    },
  };

  global.VerbaAPI = api;
})(window);
