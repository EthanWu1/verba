/* Verba API client — wraps every /api route used by the app. */
(function (global) {
  'use strict';

  async function jsonFetch(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const res = await fetch(path, { ...opts, headers });
    const txt = await res.text();
    let data;
    try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
    if (!res.ok) {
      const msg = (data && data.error) || res.statusText || ('HTTP ' + res.status);
      throw new Error(msg);
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
    libraryCards: (params = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') qs.set(k, String(v)); });
      return jsonFetch('/api/library/cards?' + qs.toString());
    },
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
      forgot: (email)                 => jsonFetch('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
      reset:  (token, password)       => jsonFetch('/api/auth/reset',  { method: 'POST', body: JSON.stringify({ token, password }) }),
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

    // --- history (localStorage-backed) ---
    history: {
      get() { try { return JSON.parse(localStorage.getItem('verba.history') || '[]'); } catch { return []; } },
      push(entry) {
        const all = this.get();
        all.unshift({ ...entry, at: new Date().toISOString() });
        localStorage.setItem('verba.history', JSON.stringify(all.slice(0, 400)));
      },
      clear() { localStorage.removeItem('verba.history'); },
    },

    // --- my-cards (localStorage-backed saved cards) ---
    mine: {
      get() { try { return JSON.parse(localStorage.getItem('verba.mycards') || '[]'); } catch { return []; } },
      fingerprint(c) {
        const t = (c.tag || '').trim().toLowerCase();
        const ci = (c.cite || c.shortCite || '').trim().toLowerCase();
        const b = String(c.body_plain || c.body_markdown || '').slice(0, 200).trim().toLowerCase();
        return t + '|' + ci + '|' + b;
      },
      save(card) {
        const all = this.get();
        const fp = this.fingerprint(card);
        const existing = all.find((c) => this.fingerprint(c) === fp);
        if (existing) return { card: existing, duplicate: true };
        const id = card.id || ('c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
        const next = { id, ...card, savedAt: new Date().toISOString() };
        all.unshift(next);
        localStorage.setItem('verba.mycards', JSON.stringify(all.slice(0, 1000)));
        return { card: next, duplicate: false };
      },
      remove(id) {
        const all = this.get().filter((c) => c.id !== id);
        localStorage.setItem('verba.mycards', JSON.stringify(all));
      },
    },
  };

  global.VerbaAPI = api;
})(window);
