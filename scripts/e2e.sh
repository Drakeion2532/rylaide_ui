#!/usr/bin/env bash
# Starts fake map services + the app on port 3100, runs the two-rider browser test, then cleans up.
# Needs: Python 3 with Playwright (pip install playwright && python -m playwright install chromium)
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
node tests/helpers/run-mock.js > "$TMP/mock.url" & MOCK=$!
for _ in $(seq 50); do [ -s "$TMP/mock.url" ] && break; sleep 0.1; done
M=$(cat "$TMP/mock.url")
DATA_FILE="$TMP/db.json" OSRM_URL="$M" NOMINATIM_URL="$M" WEATHER_URL="$M/weather" PORT=3100 node server/index.js > "$TMP/server.log" 2>&1 & APP=$!
trap 'kill $MOCK $APP 2>/dev/null || true' EXIT
for _ in $(seq 50); do curl -sf localhost:3100/healthz >/dev/null && break; sleep 0.1; done
BASE=http://localhost:3100 python3 tests/e2e.py
