'use strict';

const axios = require('axios');

const API_URL = process.env.EMBED_API_URL || 'https://openrouter.ai/api/v1/embeddings';
const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL   = process.env.EMBED_MODEL || 'voyage/voyage-3-lite';
const DIM     = Number(process.env.EMBED_DIM || 768);
const BATCH   = Number(process.env.EMBED_BATCH || 64);

async function embedTexts(texts) {
  if (!API_KEY) throw new Error('OPENROUTER_API_KEY not set');
  if (!Array.isArray(texts) || !texts.length) return [];
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH);
    const res = await axios.post(API_URL, {
      model: MODEL,
      input: chunk,
    }, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });
    const rows = res.data?.data || [];
    for (const r of rows) out.push(r.embedding);
  }
  return out;
}

async function embedOne(text) {
  const [v] = await embedTexts([String(text || '').slice(0, 4000)]);
  return v || null;
}

module.exports = { embedTexts, embedOne, DIM };
