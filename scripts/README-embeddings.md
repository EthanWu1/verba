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

Frontend not wired yet. When ready:
- Replace/augment existing FTS search with `/api/library/semantic-search`
- Debounce input 300ms
- Fall back to FTS if query < 3 words (keyword intent)
