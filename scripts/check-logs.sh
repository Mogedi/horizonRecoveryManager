#!/bin/bash
# Query production logs — designed to be run by Claude to diagnose issues.
# Usage:
#   npm run check:logs               # last 2h, all levels
#   npm run check:logs -- --since 6h
#   npm run check:logs -- --level error --since 24h
#
# Requirements: run `vercel login` once (your browser will open for auth).

SINCE="${SINCE:-2h}"
LEVEL=""

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --since) SINCE="$2"; shift ;;
    --level) LEVEL="--level $2"; shift ;;
    *) echo "Unknown arg: $1" ;;
  esac
  shift
done

echo "=== Horizon production logs (last ${SINCE}) ===" >&2
echo "Run: vercel logs --since ${SINCE} ${LEVEL} --json" >&2
echo "" >&2

vercel logs --since "${SINCE}" ${LEVEL} --json 2>&1
