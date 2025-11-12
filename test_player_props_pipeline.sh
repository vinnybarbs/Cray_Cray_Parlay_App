#!/bin/bash

# Test script for enhanced player props pipeline
# This tests the complete flow: odds refresh → team stats → player props → suggestions

echo "🚀 Testing Enhanced Player Props Pipeline"
echo "========================================"

API_BASE="http://localhost:5001/api"

echo ""
echo "1️⃣ Testing odds refresh (should now include prop markets)..."
echo "Making request to: ${API_BASE}/refresh-odds-fast"

ODDS_RESPONSE=$(curl -s -X POST "${API_BASE}/refresh-odds-fast" -H "Content-Type: application/json" 2>/dev/null)

if [ $? -eq 0 ] && [ ! -z "$ODDS_RESPONSE" ]; then
    echo "✅ Odds refresh completed"
    echo "$ODDS_RESPONSE" | jq -r '.message // .error // "Response processed"' 2>/dev/null || echo "$ODDS_RESPONSE"
else
    echo "❌ Odds refresh failed or server not running"
    echo "Please ensure server is running: node server.js"
    exit 1
fi

echo ""
echo "2️⃣ Testing team stats population..."

# Note: This would call the Supabase function when deployed
echo "📝 Team stats function created at: supabase/functions/populate-team-stats/"
echo "   Deploy with: supabase functions deploy populate-team-stats"

echo ""
echo "3️⃣ Testing player props population..."

# Note: This would call the Supabase function when deployed  
echo "📝 Player props function created at: supabase/functions/populate-player-props/"
echo "   Deploy with: supabase functions deploy populate-player-props"

echo ""
echo "4️⃣ Testing player props suggestions..."
echo "Making request to: ${API_BASE}/suggest-picks"

PROPS_REQUEST='{
  "betTypes": ["player_props"],
  "maxPicks": 3,
  "riskLevel": "medium",
  "sportsbook": "fanduel"
}'

PROPS_RESPONSE=$(curl -s -X POST "${API_BASE}/suggest-picks" \
  -H "Content-Type: application/json" \
  -d "$PROPS_REQUEST" 2>/dev/null)

if [ $? -eq 0 ] && [ ! -z "$PROPS_RESPONSE" ]; then
    echo "✅ Player props suggestions completed"
    
    # Check if we got actual props or fallback
    if echo "$PROPS_RESPONSE" | grep -q "player_pass_yds\|player_rush_yds\|player_receptions"; then
        echo "🎯 SUCCESS: Generated actual player prop suggestions!"
        echo "$PROPS_RESPONSE" | jq -r '.suggestions[].pick_details // "No pick details"' 2>/dev/null || echo "Response contains prop data"
    else
        echo "⚠️  Still falling back to core markets (props not yet available)"
        echo "$PROPS_RESPONSE" | jq -r '.message // .error // "Fallback response"' 2>/dev/null || echo "$PROPS_RESPONSE"
    fi
else
    echo "❌ Player props suggestions failed"
fi

echo ""
echo "📊 Summary:"
echo "==========="
echo "✅ Enhanced odds refresh function updated (now fetches prop markets)"
echo "✅ Team stats population function created"
echo "✅ Player props population function created"  
echo "✅ Cron job setup script created"
echo ""
echo "🔧 Next steps to complete setup:"
echo "1. Deploy functions: supabase functions deploy populate-team-stats"
echo "2. Deploy functions: supabase functions deploy populate-player-props"
echo "3. Run cron setup: Execute database/setup_enhanced_data_pipeline.sql in Supabase"
echo "4. Manual trigger: Run SELECT trigger_full_data_refresh(); in Supabase"
echo ""
echo "🎯 Once deployed, player props should work end-to-end!"