'use strict';

const { Pinecone } = require('@pinecone-database/pinecone');
const { CohereClient } = require('cohere-ai');

const EMBED_MODEL   = 'embed-english-v3.0';
const RERANK_MODEL  = process.env.COHERE_RERANK_MODEL || 'rerank-v3.5';
const UPSERT_BATCH  = 96;

let _pinecone = null;
let _index    = null;
let _cohere   = null;

function isConfigured() {
  return !!(process.env.PINECONE_API_KEY && process.env.COHERE_API_KEY && process.env.PINECONE_INDEX);
}

function getPineconeIndex() {
  if (!_index) {
    _pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    _index    = _pinecone.index(process.env.PINECONE_INDEX);
  }
  return _index;
}

function getCohere() {
  if (!_cohere) _cohere = new CohereClient({ token: process.env.COHERE_API_KEY });
  return _cohere;
}

async function embedQuery(text) {
  const resp = await getCohere().embed({
    texts: [text],
    model: EMBED_MODEL,
    inputType: 'search_query',
    embeddingTypes: ['float'],
  });
  return resp.embeddings.float[0];
}

async function embedDocuments(texts) {
  const resp = await getCohere().embed({
    texts,
    model: EMBED_MODEL,
    inputType: 'search_document',
    embeddingTypes: ['float'],
  });
  return resp.embeddings.float;
}

async function upsertCards(cards) {
  if (!isConfigured() || !cards.length) return;
  const index = getPineconeIndex();

  for (let i = 0; i < cards.length; i += UPSERT_BATCH) {
    const batch = cards.slice(i, i + UPSERT_BATCH).filter(c =>
      (c.tag || c.cite || c.body_plain || '').trim().length > 0
    );
    if (!batch.length) continue;

    const texts   = batch.map(c => `${c.tag || ''} ${c.cite || ''} ${c.body_plain || ''}`.trim());
    const vectors = await embedDocuments(texts);

    const records = batch.map((c, j) => ({
      id:       String(c.id),
      values:   vectors[j],
      metadata: {
        tag:        c.tag        || '',
        cite:       c.shortCite || c.cite || '',
        body_plain: (c.body_plain || '').slice(0, 500),
      },
    }));

    await index.upsert({ records });
    console.log(`[VECTOR] Upserted ${records.length} cards (batch ${Math.floor(i / UPSERT_BATCH) + 1})`);
  }
}

async function semanticSearch(query, topK = 50) {
  if (!isConfigured()) throw new Error('Vector search not configured');

  const index  = getPineconeIndex();
  const qvec   = await embedQuery(query);

  const pineconeResp = await index.query({
    vector:           qvec,
    topK,
    includeMetadata:  true,
  });

  const matches = pineconeResp.matches || [];
  if (!matches.length) return [];

  const docs = matches.map(m => m.metadata?.tag
    ? `${m.metadata.tag} ${m.metadata.cite} ${m.metadata.body_plain}`
    : String(m.id));

  const rerankResp = await getCohere().rerank({
    model:     RERANK_MODEL,
    query,
    documents: docs,
    topN:      matches.length,
  });

  return rerankResp.results.map(r => ({
    id:    matches[r.index].id,
    score: r.relevanceScore,
  }));
}

module.exports = { upsertCards, semanticSearch, isConfigured };
