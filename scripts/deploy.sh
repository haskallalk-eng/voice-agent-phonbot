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

# 3. Show status
docker compose ps
echo ""
echo "=== Deploy complete ==="
echo "Logs: docker compose logs -f api"
