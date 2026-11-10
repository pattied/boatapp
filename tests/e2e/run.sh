#!/bin/bash
# Full end-to-end test: builds nothing, starts the built app on a fresh local database, and drives a manager,
# a technician phone and a customer phone through every flow. Run `npm run build` first.
# Needs Playwright with Chromium available to Node (`npm i -g playwright && npx playwright install chromium`).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="${E2E_WORK:-$ROOT/.data/e2e}"
PORT="${E2E_PORT:-3100}"
pkill -f "next start -p $PORT" 2>/dev/null; pkill -f next-server 2>/dev/null; sleep 1
rm -rf "$WORK" "$ROOT/.data/files"; mkdir -p "$WORK"
cd "$ROOT"
PGLITE_DIR="$WORK/pg" APP_PASSCODE=crispclean MANAGER_PASSCODE=boss-pass SALES_PASSCODE=sales-pass MANAGER_PHONE=415-555-0100 \
  MESSAGING_INBOUND_SECRET=e2e-inbound MESSAGING_FAKE_NOW=2026-11-10T20:00:00Z BUSINESS_ADDRESS="100 Harbor Dr, Sausalito, CA 94965" APP_URL="http://localhost:$PORT" \
  nohup npx next start -p "$PORT" > "$WORK/server.log" 2>&1 &
sleep 6
BASE="http://localhost:$PORT" E2E_OUT="$WORK" timeout 500 node "$HERE/full.js"
CODE=$?
pkill -f next-server 2>/dev/null
exit $CODE
