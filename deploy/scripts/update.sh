#!/usr/bin/env bash
# Mise à jour depuis GitHub : git pull puis reconstruction des conteneurs modifiés.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose up -d --build
docker image prune -f
