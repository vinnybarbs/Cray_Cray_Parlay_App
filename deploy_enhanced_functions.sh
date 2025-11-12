#!/bin/bash

# Deploy enhanced Edge functions to Supabase
# Run this script to deploy all the player props and team stats enhancements

echo "🚀 Deploying enhanced Edge functions..."

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Install with: npm install -g supabase"
    exit 1
fi

# Login check
echo "🔐 Checking Supabase authentication..."
supabase status

# Deploy all functions
echo "📦 Deploying Edge functions..."

# Deploy the enhanced refresh-odds-fast function (with player props)
echo "  ↳ refresh-odds-fast (enhanced with player props)"
supabase functions deploy refresh-odds-fast

# Deploy team stats population function  
echo "  ↳ populate-team-stats"
supabase functions deploy populate-team-stats

# Deploy player props population function
echo "  ↳ populate-player-props" 
supabase functions deploy populate-player-props

echo ""
echo "✅ All Edge functions deployed!"
echo ""
echo "🧪 Test the enhanced functions:"
echo "   curl -X POST \"\$SUPABASE_URL/functions/v1/refresh-odds-fast\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\""
echo "   curl -X POST \"\$SUPABASE_URL/functions/v1/populate-team-stats\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\""  
echo "   curl -X POST \"\$SUPABASE_URL/functions/v1/populate-player-props\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\""
echo ""
echo "🔄 After deployment, run the odds refresh to populate prop markets:"
echo "   curl -X POST \"https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/refresh-odds-fast\" \\"
echo "     -H \"Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs\""