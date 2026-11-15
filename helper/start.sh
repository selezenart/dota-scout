#!/bin/sh
# Captain's Draft Board local helper (macOS/Linux).
# Put your Steam Web API key on one line in steam-key.txt next to this file.
# Optional overrides: DOTA_CONSOLE_LOG=/path/to/console.log DOTA_ACCOUNT_ID=123456789 ./start.sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is required. Install it from https://nodejs.org and run this script again."
  exit 1
fi
exec node server.mjs
