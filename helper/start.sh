#!/bin/sh
# Captain's Draft Board local helper (macOS/Linux).
# One-time setup: npm ci --ignore-scripts && npm run bot-login (see README.md).
# Optional: a Steam Web API key on one line in steam-key.txt next to this file.
# Optional overrides: DOTA_CONSOLE_LOG=/path/to/console.log DOTA_ACCOUNT_ID=123456789 ./start.sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required. Install it from https://nodejs.org and run this script again."
  exit 1
fi
if [ -f bot-login-token.txt ] && [ ! -d node_modules/steam-user ]; then
  echo "Installing the helper's one dependency (steam-user)..."
  npm ci --ignore-scripts || exit 1
fi
exec node server.mjs
