#!/usr/bin/env bash
# Sets a temporary password for an account (e.g. the administrator forgot it).
#
#   cd deploy && ./reset-password.sh admin@empresa.com
#
# Prints the temporary password; the person signs in and changes it under
# "Conta". Recorded in the activity log.
set -euo pipefail
cd "$(dirname "$0")"
email="${1:?uso: ./reset-password.sh email@empresa.com}"
docker compose exec -T backend node dist/cli/reset-password.js "$email"
