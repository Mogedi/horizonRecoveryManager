#!/usr/bin/env bash
# Research-ops monitor — pulls Browser Use + Firecrawl activity/usage/cost DIRECTLY from their own APIs,
# so we see what the agent's tools are actually doing/costing, not just what the VPS reports.
#
#   HERMES_VPS=mo@<vps-ip> bash scripts/research-ops.sh
#
# Read-only, ephemeral, NO database writes. The API keys live in the agent container's /opt/data/.env and
# never leave the VPS — this script reads them there and curls from the VPS. Run it any time to check:
#   • Firecrawl  — remaining/plan credits (cost ceiling)
#   • Browser Use — active sessions (liveUrl to watch) + recent sessions (status, $cost, recordingUrl)
set -euo pipefail
HOST="${HERMES_VPS:?set HERMES_VPS=mo@<vps-ip>}"
KEY="${HERMES_SSH_KEY:-$HOME/.ssh/hermes_vps}"

ssh -i "$KEY" -o ConnectTimeout=25 "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
C=$(docker ps --filter name=hermes-agent --format "{{.Names}}" | head -1)
BU=$(docker exec "$C" sh -c "grep ^BROWSER_USE_API_KEY= /opt/data/.env | cut -d= -f2-")
FC=$(docker exec "$C" sh -c "grep ^FIRECRAWL_API_KEY= /opt/data/.env | cut -d= -f2-")
fmt(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.stringify(JSON.parse(s),null,1))}catch{console.log(s)}})'; }

echo "════ FIRECRAWL credits ════"
curl -s -m 20 -H "Authorization: Bearer $FC" https://api.firecrawl.dev/v2/team/credit-usage | fmt

echo; echo "════ BROWSER USE — active sessions (liveUrl = watch live) ════"
curl -s -m 20 -H "X-Browser-Use-API-Key: $BU" "https://api.browser-use.com/api/v3/sessions?limit=5" | fmt

echo; echo "════ BROWSER USE — recent browsers (status · cost · recordingUrl) ════"
curl -s -m 20 -H "X-Browser-Use-API-Key: $BU" "https://api.browser-use.com/api/v3/browsers?limit=6" | fmt
REMOTE
