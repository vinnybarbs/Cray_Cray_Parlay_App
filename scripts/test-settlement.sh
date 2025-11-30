#!/bin/bash

# Test settlement endpoint and show results
echo "🔄 Testing parlay settlement endpoint..."
echo ""

# Call settlement API
response=$(curl -s -X POST https://craycrayparlayapp-production.up.railway.app/api/check-parlays)

# Pretty print the response
echo "📊 Settlement Response:"
echo "$response" | jq '.' 2>/dev/null || echo "$response"

echo ""
echo "✅ Test complete!"
echo ""
echo "💡 Next steps:"
echo "   1. Check settlement_monitor view in Supabase"
echo "   2. Run: SELECT * FROM settlement_monitor;"
echo "   3. View detailed status: see monitor-settlement.sql"
