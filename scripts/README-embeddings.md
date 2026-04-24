# Semantic search embedding job

## One-time setup (done)

- `sqlite-vec` dep in package.json
- `server/services/embedder.js` — OpenRouter embedding API client
- `server/services/semanticIndex.js` — sqlite-vec vec table + knn query
- `scripts/embed-library.js` — batch job (manual trigger)
- `GET /api/library/semantic-search?q=<text>&k=25` — runtime search route

## When ready to embed

On the server:

```bash
cd ~/verba
npm install                 # installs sqlite-vec native binary
node scripts/embed-library.js          # incremental; skips duplicates + already-embedded
# or
node scripts/embed-library.js --limit=1000  # cap for a dry run
node scripts/embed-library.js --force       # re-embed everything
```

## Filters applied automatically

- Cards WITHOUT `==highlight==` markers are skipped (skips raw imports that were never cut)
- Highlights < 20 chars = skipped
- Exact-duplicate highlight text (by SHA256) embedded once, not per card
- Hash stored per card → next run skips unchanged content

## Sizing (approx)

- 156K total cards
- ~highlighted fraction after dedupe = estimate ~30-40K unique embeddings needed
- voyage-3-lite at 64 batch, 50ms/req = ~30 minutes full run
- Disk: 30K × 768 × 4 bytes = ~90 MB

## Env vars

Optional overrides:
- `EMBED_MODEL` (default `openai/text-embedding-3-small`)
- `EMBED_API_URL` (default `https://openrouter.ai/api/v1/embeddings`)
- `EMBED_DIM` (default `1536`; must match model)
- `EMBED_BATCH` (default `64`)

Required: `OPENROUTER_API_KEY` (already in .env).

## Runtime cost after embed

- Query embedding: ~50ms, cached LRU (256 queries)
- vec KNN lookup: <5ms on 30-90K rows
- Total per query: ~55ms (uncached), ~5ms (cached)

## UI integration

Library evidence search in `public/app-main.js` fires both `API.libraryCards` (FTS) and `API.librarySemantic` in parallel. FTS paints instantly; semantic result replaces when it comes back.

## Rollback

If semantic search misbehaves:

1. **Kill the UI hybrid path** (surgical): revert the semantic block in `runEvidenceSearch` in `public/app-main.js` — FTS-only path is the first promise.

2. **Kill the endpoint**: in `server/routes/library.js`, short-circuit `/semantic-search` to always return `{results:[]}`. Leaves vec data on disk.

3. **Nuke the extension + data** (last resort):
   ```bash
   pm2 stop verba
   cp ~/backups/library-pre-vec-<TIMESTAMP>.db ~/verba/server/data/library.db
   rm -f ~/verba/server/data/library.db-wal ~/verba/server/data/library.db-shm
   pm2 start verba
   ```

Fail-safe load in `semanticIndex.js` means a broken `sqlite-vec` install won't 500 regular queries — KNN returns empty, hybrid collapses to FTS.
