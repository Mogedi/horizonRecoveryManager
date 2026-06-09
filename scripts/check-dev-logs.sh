#!/bin/bash
# Surfaces recent errors from the dev server log.
# Called automatically after npm test (posttest hook).
# Silent no-op when dev server isn't running.
#
# Catches two types of errors:
#   1. Structured JSON logs: {"level":"error",...}  — our logger output
#   2. Plain-text errors:   prisma:error, ⨯ Error, HTTP 500 lines
#      (Prisma validation errors and Next.js framework errors bypass our logger)
#
# Run manually:  bash scripts/check-dev-logs.sh
#                bash scripts/check-dev-logs.sh --all   (show info + warn + error)

LOG_FILE="/tmp/horizon-dev.log"

if [ ! -f "$LOG_FILE" ]; then
  exit 0  # dev server not running — nothing to check
fi

SHOW_ALL=false
[ "$1" = "--all" ] && SHOW_ALL=true

# Scan last 500 lines so we don't surface stale errors from hours ago
RECENT=$(tail -500 "$LOG_FILE")

if $SHOW_ALL; then
  STRUCTURED=$(echo "$RECENT" | grep -E '"level":"(error|warn|info)"')
else
  STRUCTURED=$(echo "$RECENT" | grep -E '"level":"(error|warn)"')
fi

# Plain-text errors that bypass our structured logger:
#   - "prisma:error" — Prisma client validation / query errors
#   - "⨯ Error" — Next.js unhandled error formatting
#   - " 500 in " — HTTP 500 response lines from Next.js access log
PLAINTEXT=$(echo "$RECENT" | grep -E '(prisma:error|⨯ Error|\] Error| 500 in )' | grep -v 'node_modules')

HITS=$(printf '%s\n%s' "$STRUCTURED" "$PLAINTEXT" | grep -v '^$')

if [ -z "$HITS" ]; then
  echo "  [dev log] no errors or warnings in recent output"
else
  COUNT=$(echo "$HITS" | wc -l | tr -d ' ')
  echo "  [dev log] $COUNT recent entries:"
  echo "$HITS" | tail -20
fi
