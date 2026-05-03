/**
 * services/embedder.js — v3.0 (local, no API)
 *
 * Embeds via @xenova/transformers (ONNX runtime, pure JS, no native build).
 * Default model: Xenova/all-MiniLM-L6-v2 → 384-dim sentence embeddings.
 *
 * First run downloads the model (~25 MB) into @xenova's cache dir under
 * node_modules. Subsequent runs are instant cold-start.
 *
 * Public surface unchanged:
 *   - embedTexts(texts: string[]) → Promise<number[][]>
 *   - embedOne(text: string)      → Promise<number[]>
 *   - DIM (constant)
 *
 * Override via env:
 *   - EMBED_MODEL (default Xenova/all-MiniLM-L6-v2)
 *   - EMBED_DIM   (default 384; must match the model)
 *   - EMBED_BATCH (default 32; in-process batch size)
 */

'use strict';

const MODEL = process.env.EMBED_MODEL || 'Xenova/all-MiniLM-L6-v2';
const DIM   = Number(process.env.EMBED_DIM || 384);
const BATCH = Number(process.env.EMBED_BATCH || 32);

let _pipelinePromise = null;

async function getPipeline() {
  if (!_pipelinePromise) {
    _pipelinePromise = (async () => {
      // Dynamic import — @xenova/transformers is ESM-only.
      const { pipeline, env } = await import('@xenova/transformers');
      // Disable telemetry; cap parallel downloads. No network calls after first run.
      env.allowLocalModels = true;
      env.useBrowserCache  = false;
      console.log(`[embedder] Loading ${MODEL} (first run downloads ~25MB)...`);
      const t0 = Date.now();
      const extractor = await pipeline('feature-extraction', MODEL, {
        quantized: true,  // Use the int8 quantized weights — 4x smaller, ~same quality.
      });
      console.log(`[embedder] Loaded ${MODEL} in ${Date.now() - t0}ms`);
      return extractor;
    })().catch(err => {
      // Allow retry on next call if first load fails (e.g. transient download error).
      _pipelinePromise = null;
      throw err;
    });
  }
  return _pipelinePromise;
}

async function embedTexts(texts) {
  if (!Array.isArray(texts) || !texts.length) return [];
  const extractor = await getPipeline();
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH).map(t => String(t || '').slice(0, 4000));
    // Mean-pooled, L2-normalized vectors — what KNN cosine similarity expects.
    const result = await extractor(chunk, { pooling: 'mean', normalize: true });
    // result is a Tensor: shape [batch, dim], data is Float32Array of length batch*dim.
    const data = result.data;
    const dim  = result.dims?.[1] || DIM;
    for (let r = 0; r < chunk.length; r++) {
      out.push(Array.from(data.subarray(r * dim, (r + 1) * dim)));
    }
  }
  return out;
}

async function embedOne(text) {
  const [v] = await embedTexts([String(text || '').slice(0, 4000)]);
  return v || null;
}

module.exports = { embedTexts, embedOne, DIM };
