#!/usr/bin/env bash
# Backs up the database and the uploaded files into deploy/backups/.
#
#   cd deploy && ./backup.sh
#
# Schedule it (e.g. daily with cron) and copy deploy/backups/ to another disk:
# a backup on the same disk does not survive the disk. Keep deploy/.env safe
# too: it holds the keys of this installation.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
stamp=$(date +%Y%m%d-%H%M%S)

docker compose exec -T db pg_dump -U dollma --clean --if-exists dollma | gzip > "backups/db-$stamp.sql.gz"
docker compose exec -T backend tar czf - -C /app uploads > "backups/uploads-$stamp.tar.gz"
chmod 600 "backups/db-$stamp.sql.gz" "backups/uploads-$stamp.tar.gz"

echo "Backup salvo em deploy/backups/:"
ls -lh "backups/db-$stamp.sql.gz" "backups/uploads-$stamp.tar.gz"
