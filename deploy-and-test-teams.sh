#!/bin/bash

echo "🚀 Deploying and testing team population pipeline"
echo "================================================"

# Deploy the populate-teams function
echo "1️⃣ Deploying populate-teams Edge function..."
supabase functions deploy populate-teams

if [ $? -ne 0 ]; then
    echo "❌ Failed to deploy populate-teams function"
    exit 1
fi

echo "✅ populate-teams function deployed successfully"
echo ""

# Load environment variables
source .env

# Test the function
echo "2️⃣ Testing team population..."
echo "This will:"
echo "   - Fetch teams for ALL sports (NFL, NBA, MLB, NHL, EPL, NCAAF)"
echo "   - Map players to teams for prop sports only (NFL, NBA, MLB)"
echo ""

RESPONSE=$(curl -s -X POST "https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/populate-teams" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}')

echo "📊 Team Population Results:"
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"

echo ""
echo "3️⃣ Next steps after team population:"
echo "   - Teams table will have all sports"
echo "   - Players (NFL/NBA/MLB only) will have team_id mapped" 
echo "   - suggest-picks API can now use INNER JOIN properly"
echo "   - Player props should work end-to-end!"
echo ""
echo "🧪 Test player props with:"
echo "   curl -X POST http://localhost:5001/api/suggest-picks \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"betTypes\": [\"player_props\"], \"maxPicks\": 2}'"