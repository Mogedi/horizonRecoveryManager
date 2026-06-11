#!/usr/bin/env bash
# Deploy the hermes/ tools to the VPS and restart the bot — the "edit a tool → it's live" loop.
#   HERMES_VPS=mo@<vps-ip> npm run deploy        (or `export HERMES_VPS=...` in your shell profile)
# Optional: HERMES_SSH_KEY=~/.ssh/hermes_vps (default).
set -euo pipefail
HOST="${HERMES_VPS:?set HERMES_VPS=mo@<vps-ip>}"
KEY="${HERMES_SSH_KEY:-$HOME/.ssh/hermes_vps}"
DIR="$(cd "$(dirname "$0")" && pwd)"

rsync -az --exclude node_modules --exclude .env -e "ssh -i $KEY" "$DIR/" "$HOST:hermes/"
ssh -i "$KEY" "$HOST" 'cd ~/hermes && npm install --no-audit --no-fund >/dev/null && pm2 restart hermes-bot --update-env'
echo "✓ deployed to $HOST and restarted hermes-bot"
