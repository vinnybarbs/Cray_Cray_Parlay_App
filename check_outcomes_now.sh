#!/bin/bash
# Manually trigger parlay outcome checking

echo "🔍 Checking parlay outcomes now..."
echo ""

curl -X POST \
  https://craycrayparlayapp-production.up.railway.app/api/cron/check-parlays \
  -H "Content-Type: application/json" \
  -d '{}'

echo ""
echo ""
echo "✅ Outcome check triggered!"
echo "Refresh your dashboard to see updated results."
