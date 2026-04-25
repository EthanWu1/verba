---
name: embed-cards
description: Run the offline embedding pipeline for canonical+highlighted library cards. Wraps scripts/embed-library.js with disk-space, WAL, and pm2 safety checks. Use when vec_rows < eligible cards or after a large card import.
disable-model-invocation: true
---

# Embed cards (offline batch)

Fills the `cards_vec` index with embeddings for `isCanonical=1 AND hasHighlight=1` cards. Skips already-embedded rows by SHA256 hash of highlights.

## Pre-flight (do these every time)

```bash
# 1. Disk + WAL state
df -h ~
ls -lh ~/verba/server/data/library.db*

# 2. Coverage gap (run on the server)
sqlite3 ~/verba/server/data/library.db <<'SQL'
SELECT (SELECT COUNT(*) FROM cards_vec_rowids) AS embedded,
       (SELECT COUNT(*) FROM cards
         WHERE isCanonical=1 AND hasHighlight=1
           AND highlightWordCount >= 6
           AND tag IS NOT NULL AND TRIM(tag) != '') AS eligible;
SQL
```

If `df` shows < 2GB free, **stop** — VACUUM/cleanup first; embed run will inflate the WAL.

## Run

```bash
cd ~/verba && pm2 stop verba && \
  node scripts/embed-library.js && \
  sqlite3 ~/verba/server/data/library.db "PRAGMA wal_checkpoint(TRUNCATE);" && \
  pm2 start verba
```

Flags:
- `--force` — re-embed every eligible card (otherwise skips by hash)
- `--limit=N` — cap cards processed (use `--limit=500` to dry-run)

## Notes

- Embedder uses `EMBED_MODEL` from `.env` (default `openai/text-embedding-3-small`, 1536-dim) via OpenRouter.
- Cost: $0.02 per 1M tokens. Full corpus (~47k cards × ~150 tokens) ≈ $0.14.
- Latency: ~10–15 min on a complete run; minutes on incremental.
- Embeddings of demoted/unhighlighted cards remain in `cards_vec` (no auto-prune); the runtime route filters them out via `hasHighlight=1 AND highlightWordCount >= 6` so this is safe.

## Verify after run

```bash
sqlite3 ~/verba/server/data/library.db <<'SQL'
SELECT (SELECT COUNT(*) FROM cards_vec_rowids) AS embedded,
       (SELECT MAX(occurredAt) FROM toc_rating_history) AS most_recent_history;
SQL
curl -s --max-time 10 'http://localhost:3000/api/library/semantic-search?q=nuclear%20deterrence&k=5' \
  | python3 -m json.tool | grep '"tag"' | head -5
```

Top hits should have non-empty tags and visible highlights when clicked.
