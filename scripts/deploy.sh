#!/bin/bash
# Phonbot Production Deploy Script
# Run this on the server after first-time setup, or for every update.
set -e

echo "=== Phonbot Deploy ==="

# 1. Pull latest code
git pull origin master

# 2. Build & restart containers
docker compose build --no-cache
docker compose up -d

# 3. Show status
docker compose ps
echo ""
echo "=== Deploy complete ==="
echo "Logs: docker compose logs -f api"
