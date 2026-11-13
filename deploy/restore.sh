#!/usr/bin/env bash
# Restores a backup made by backup.sh, REPLACING the current data.
#
#   cd deploy && ./restore.sh backups/db-<data>.sql.gz backups/uploads-<data>.tar.gz
set -euo pipefail
cd "$(dirname "$0")"
db="${1:?uso: ./restore.sh backups/db-<data>.sql.gz backups/uploads-<data>.tar.gz}"
files="${2:?uso: ./restore.sh backups/db-<data>.sql.gz backups/uploads-<data>.tar.gz}"
[ -f "$db" ] && [ -f "$files" ] || { echo "Arquivo de backup não encontrado." >&2; exit 1; }

read -r -p "Isto substitui TODOS os dados atuais pelos do backup. Digite RESTAURAR para continuar: " answer
[ "$answer" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }

docker compose stop frontend backend
gunzip -c "$db" | docker compose exec -T db psql -q -U dollma -d dollma -v ON_ERROR_STOP=1 >/dev/null
docker compose run --rm --no-deps -T --entrypoint sh backend \
  -c 'find /app/uploads -mindepth 1 -delete && tar xzf - -C /app' < "$files"
docker compose up -d
echo "Backup restaurado."
