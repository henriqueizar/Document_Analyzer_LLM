#!/usr/bin/env bash
# Updates to the latest version: new code, new images, database migrations
# (applied automatically when the backend starts). Make a backup first.
#
#   cd deploy && ./backup.sh && ./update.sh
set -euo pipefail
cd "$(dirname "$0")"
git pull --ff-only
docker compose up -d --build
docker compose ps
