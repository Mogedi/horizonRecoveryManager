#!/bin/bash
# Surfaces recent errors from the dev server log.
# Called automatically after npm test (posttest hook).
# Silent no-op when dev server isn't running.
#
# Run manually:  bash scripts/check-dev-logs.sh
#                bash scripts/check-dev-logs.sh --all   (show info + warn + error)

LOG_FILE="/tmp/horizon-dev.log"

if [ ! -f "$LOG_FILE" ]; then
  exit 0  # dev server not running — nothing to check
fi

SHOW_ALL=false
[ "$1" = "--all" ] && SHOW_ALL=true

# Scan last 300 lines so we don't surface stale errors from hours ago
RECENT=$(tail -300 "$LOG_FILE")

if $SHOW_ALL; then
  HITS=$(echo "$RECENT" | grep -E '"level":"(error|warn|info)"')
else
  HITS=$(echo "$RECENT" | grep -E '"level":"(error|warn)"')
fi

if [ -z "$HITS" ]; then
  echo "  [dev log] no errors or warnings in recent output"
else
  COUNT=$(echo "$HITS" | wc -l | tr -d ' ')
  echo "  [dev log] $COUNT recent entries:"
  echo "$HITS" | tail -20
fi
