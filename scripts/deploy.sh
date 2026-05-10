#!/bin/bash
# Phonbot Production Deploy Script
# Run this on the server after first-time setup, or for every update.
set -e

echo "=== Phonbot Deploy ==="

# 1. Pull latest code
git pull origin master

# 2. Build & restart containers
#
# NOTE: --no-cache was here before 2026-04-22. It took the VPS offline
# (OOM → SSH + Docker killed) because the full rebuild peaks well over
# 1.5 GB RAM on a 1.8 GB VPS. Regular build reuses Docker layer cache,
# so only changed layers rebuild — ~300-500 MB peak. Use --no-cache
# manually (BUILD_CLEAN=1 ./deploy.sh) when you really need to bust
# the cache (e.g. after a base-image security update).
if [ "${BUILD_CLEAN:-}" = "1" ]; then
  echo "BUILD_CLEAN=1 → full rebuild (high RAM, ensure swap or headroom)"
  docker compose build --no-cache
else
  docker compose build
fi
docker compose up -d

# 3. Keep existing Retell agents on the current signed tool URL contract.
# A normal API deploy can change tool schemas or auth query params; without
# this sync, old Retell LLM tool URLs may continue calling stale endpoints.
if [ "${SKIP_RETELL_SYNC:-}" != "1" ]; then
  api_container="$(docker compose ps -q api)"
  if [ -n "$api_container" ]; then
    if ! docker exec "$api_container" sh -lc 'test -n "$WEBHOOK_BASE_URL"'; then
      echo "ERROR: WEBHOOK_BASE_URL is missing inside the api container; refusing to sync Retell URLs." >&2
      exit 1
    fi
    docker exec "$api_container" node apps/api/dist/scripts/sync-retell-active-configs.js --execute
  fi
fi

# 4. Show status
docker compose ps
echo ""
echo "=== Deploy complete ==="
echo "Logs: docker compose logs -f api"
