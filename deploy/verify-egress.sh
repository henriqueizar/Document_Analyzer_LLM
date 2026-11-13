#!/usr/bin/env bash
# Proves that the production installation sends nothing outside itself.
#
#   cd deploy && ./verify-egress.sh
#
# Starts a SEPARATE, temporary installation (project dollma-egress, ports
# 18080/18443: a real installation is not touched), with a monitor inside the
# backend and frontend processes that records every DNS lookup and connection
# they attempt. A client then does what users do, over HTTPS through the proxy:
# setup, sign-in, upload with OCR, explanation, question, pages, admin panel.
# The check fails if any attempt targets something other than this
# installation's own services. Everything is removed at the end.
#
# The LLM is a stand-in on the isolated network (a real model would need
# gigabytes); the application's call to it is the same HTTP call.
set -euo pipefail
cd "$(dirname "$0")"

env_file=$(mktemp)
rand() { od -An -tx1 -N24 /dev/urandom | tr -d ' \n'; }
cat > "$env_file" <<ENV
COMPOSE_PROJECT_NAME=dollma-egress
COMPOSE_FILE=docker-compose.yml:verify-egress/docker-compose.yml
COMPOSE_PROFILES=ollama
SITE_ADDRESS=proxy
SITE_URL=https://proxy
HTTP_PORT=18080
HTTPS_PORT=18443
LLM_MODEL=qwen3:8b
POSTGRES_PASSWORD=$(rand)
BACKEND_JWT_SECRET=$(rand)
NEXTAUTH_SECRET=$(rand)
ENV
compose() { docker compose --env-file "$env_file" "$@"; }
cleanup() { compose --profile client --profile ollama down -v >/dev/null 2>&1 || true; rm -f "$env_file"; }
trap cleanup EXIT

echo "1/3 Starting a temporary installation with the connection monitor..."
if [ "${DOLLMA_SKIP_BUILD:-0}" = 1 ]; then compose up -d --wait; else compose up -d --build --wait; fi

echo "2/3 Doing what users do (HTTPS through the proxy)..."
compose --profile client run --rm client

echo "3/3 Every lookup and connection the backend and frontend attempted:"
subnet=$(docker network inspect dollma-egress_private -f '{{(index .IPAM.Config 0).Subnet}}')
# Control: a deliberate attempt to an outside name. The monitor must see it,
# otherwise "nothing outside" would only mean the monitor is blind.
compose exec -T backend node -e "fetch('http://egress-canary.invalid/').catch(() => {})"
compose exec -T backend node /monitor/check.cjs "$subnet" egress-canary.invalid
