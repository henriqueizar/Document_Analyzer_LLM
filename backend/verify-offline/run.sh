#!/bin/sh
# Runs inside the isolated container (see docker-compose.yml).
set -e

echo "1/3 Checking that this container really has no internet access..."
node verify-offline/assert-no-internet.js

echo "2/3 Preparing the database..."
npx prisma migrate deploy >/dev/null

echo "3/3 Running the full flow without internet (login, upload, OCR, questions)..."
npm run test:e2e --silent

echo
echo "OK: the application worked with no internet access."
