#!/usr/bin/env bash
set -euo pipefail

HOST="${SEMANTIC_SMOKE_HOST:-http://127.0.0.1:3000}"

echo "== diag =="
curl -s -w "\nstatus=%{http_code}\n" "$HOST/api/library/semantic-search?diag=1"

echo
echo "== queries =="
for q in "nuclear war" "economic growth" "moral obligation" "deterrence"; do
  echo "--- $q ---"
  curl -s -w "time=%{time_total}s status=%{http_code}\n" \
    "$HOST/api/library/semantic-search?q=$(printf %s "$q" | sed 's/ /%20/g')&k=5" \
    | head -c 400
  echo
done
