#!/bin/sh
# Builds the image (needs internet once), runs the check on an isolated
# network, cleans up, and exits with the check's result.
cd "$(dirname "$0")" || exit 1
docker compose up --build --abort-on-container-exit --exit-code-from verify
code=$?
docker compose down -v >/dev/null 2>&1
if [ "$code" -eq 0 ]; then
  echo "Offline verification passed."
else
  echo "Offline verification FAILED (exit code $code)."
fi
exit "$code"
