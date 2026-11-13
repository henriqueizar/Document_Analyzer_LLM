#!/bin/sh
# Runs inside the "backup" service (see docker-compose.yml): a backup of the
# database and the uploaded files when the installation starts and then every
# BACKUP_EVERY_HOURS hours, into deploy/backups/, keeping BACKUP_KEEP_DAYS days.
# It is on the isolated network: it reaches the database, nothing else.
set -u
umask 077
every=$(( ${BACKUP_EVERY_HOURS:-24} * 3600 ))
keep=${BACKUP_KEEP_DAYS:-14}
while true; do
  stamp=$(date +%Y%m%d-%H%M%S)
  if pg_dump -h db -U dollma --clean --if-exists dollma | gzip > "/backups/db-$stamp.sql.gz.part" \
    && tar czf "/backups/uploads-$stamp.tar.gz.part" -C / uploads; then
    mv "/backups/db-$stamp.sql.gz.part" "/backups/db-$stamp.sql.gz"
    mv "/backups/uploads-$stamp.tar.gz.part" "/backups/uploads-$stamp.tar.gz"
    echo "$(date -Iseconds) backup ok: db-$stamp.sql.gz, uploads-$stamp.tar.gz"
  else
    rm -f /backups/*.part
    echo "$(date -Iseconds) backup FAILED" >&2
  fi
  find /backups -maxdepth 1 \( -name 'db-*.sql.gz' -o -name 'uploads-*.tar.gz' \) -mtime +"$keep" -delete
  sleep "$every"
done
