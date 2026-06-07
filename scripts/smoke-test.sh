#!/bin/bash
# Smoke test: every protected route must block unauthenticated requests.
# Accepts 401 (route-level block) or 307/302 (proxy redirect to /login).
#
# Usage:
#   npm run smoke                   # tests localhost:3000
#   npm run smoke http://localhost:3001
#   npm run smoke https://your-vercel-url.vercel.app

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0

check() {
  local method="$1"
  local path="$2"
  local body="$3"
  local label="$method $path"

  if [ -n "$body" ]; then
    status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" \
      -H "Content-Type: application/json" \
      --max-time 10 \
      -d "$body" \
      "${BASE_URL}${path}")
  else
    status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" \
      --max-time 10 \
      "${BASE_URL}${path}")
  fi

  # 401 = route blocked it, 307/302 = proxy redirected to /login — both are correct
  if [[ "$status" == "401" || "$status" == "307" || "$status" == "302" ]]; then
    echo "  PASS  $label → $status"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label → $status (expected 401 or redirect)"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "Horizon smoke test — unauthenticated requests must be blocked"
echo "Base: $BASE_URL"
echo ""

echo "--- Deals ---"
check GET    "/api/deals"                             ""
check GET    "/api/deals/FAKE_DEAL_ID"               ""
check POST   "/api/deals/FAKE_DEAL_ID/summary"       "{}"
check POST   "/api/deals/FAKE_DEAL_ID/snooze"        '{"category":"waiting_on_client","snoozeUntil":"2099-01-01T00:00:00Z"}'
check DELETE "/api/deals/FAKE_DEAL_ID/snooze"        ""

echo ""
echo "--- Tasks ---"
check GET    "/api/tasks"                             ""
check GET    "/api/tasks/count"                       ""
check POST   "/api/tasks"                             '{"title":"test","category":"FOLLOW_UP"}'
check PATCH  "/api/tasks/1"                           "{}"
check DELETE "/api/tasks/1"                           ""

echo ""
echo "--- Settings ---"
check GET    "/api/settings"                          ""
check PATCH  "/api/settings"                          '{"settings":[]}'

echo ""
echo "--- Sync ---"
check POST   "/api/sync/layer1"                       "{}"
check POST   "/api/sync/layer2/FAKE_DEAL_ID"          "{}"

echo ""
echo "--- Briefing ---"
check POST   "/api/briefing"                          "{}"

echo ""
echo "--- Auth routes (must be open) ---"
auth_status=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"password":"wrong"}' \
  --max-time 10 \
  "${BASE_URL}/api/auth/login")
if [[ "$auth_status" == "401" ]]; then
  echo "  PASS  POST /api/auth/login (wrong password) → 401"
  PASS=$((PASS + 1))
else
  echo "  FAIL  POST /api/auth/login (wrong password) → $auth_status (expected 401)"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "================================================"
echo "  $PASS passed   $FAIL failed"
echo "================================================"
echo ""

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
