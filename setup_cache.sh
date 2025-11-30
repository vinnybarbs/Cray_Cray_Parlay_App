#!/bin/bash

echo "🚀 Setting up AI Suggestions Cache..."
echo ""

# Check if supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Install with: npm install -g supabase"
    exit 1
fi

echo "✅ Supabase CLI found"
echo ""

# Link to project if not already linked
echo "🔗 Linking to Supabase project..."
supabase link --project-ref $(grep SUPABASE_URL .env.local | cut -d'/' -f3 | cut -d'.' -f1) || true

echo ""
echo "📊 Creating ai_suggestions_cache table..."

# Run the SQL migration
supabase db push --dry-run || true

# If dry-run works, actually push
supabase migration new create_suggestions_cache
cp database/create_suggestions_cache.sql supabase/migrations/$(ls -t supabase/migrations/ | head -1)

echo ""
echo "✅ Migration created!"
echo ""
echo "Now run:"
echo "  supabase db push"
echo ""
echo "Or execute SQL directly in Supabase dashboard:"
echo "  1. Go to https://supabase.com/dashboard/project/YOUR_PROJECT/editor"
echo "  2. Open: database/create_suggestions_cache.sql"
echo "  3. Copy and paste into SQL Editor"
echo "  4. Click 'Run'"
