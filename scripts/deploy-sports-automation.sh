#!/bin/bash

# Sports Data Automation Deployment Script
# This script deploys the edge functions and applies the cron job configuration

set -e

echo "🚀 Deploying Sports Data Automation System..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    print_error "Supabase CLI is not installed. Please install it first:"
    echo "npm install -g supabase"
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "supabase/config.toml" ]; then
    print_error "supabase/config.toml not found. Make sure you're in the project root."
    exit 1
fi

print_status "Checking Supabase connection..."

# Test connection
if ! supabase projects list &> /dev/null; then
    print_error "Not logged into Supabase. Please run: supabase auth login"
    exit 1
fi

print_status "Deploying Edge Functions..."

# Deploy each edge function
FUNCTIONS=(
    "refresh-team-stats"
    "refresh-player-stats"
    "refresh-injuries" 
    "refresh-rosters"
    "sports-data-health-check"
)

for func in "${FUNCTIONS[@]}"; do
    print_status "Deploying $func..."
    if supabase functions deploy "$func" --project-ref $(supabase projects list --format json | jq -r '.[0].id' 2>/dev/null || echo ""); then
        print_status "✅ $func deployed successfully"
    else
        print_error "❌ Failed to deploy $func"
        exit 1
    fi
done

print_status "Applying database migrations..."

# Apply the cron job setup
if supabase db push; then
    print_status "✅ Database migrations applied"
else
    print_warning "⚠️  Database push failed - you may need to apply manually"
fi

print_status "Setting up cron jobs..."

# Apply cron job configuration
if psql "$DATABASE_URL" -f database/setup_sports_data_cron_jobs.sql 2>/dev/null || \
   supabase db reset --db-url "$DATABASE_URL" --file database/setup_sports_data_cron_jobs.sql 2>/dev/null; then
    print_status "✅ Cron jobs configured"
else
    print_warning "⚠️  Could not automatically apply cron jobs. Please run manually:"
    echo "   psql \$DATABASE_URL -f database/setup_sports_data_cron_jobs.sql"
fi

print_status "Verifying deployment..."

# Test each function
for func in "${FUNCTIONS[@]}"; do
    print_status "Testing $func..."
    FUNCTION_URL="https://$(supabase projects list --format json | jq -r '.[0].id' 2>/dev/null || echo 'PROJECT_ID').supabase.co/functions/v1/$func"
    
    if curl -s -X POST "$FUNCTION_URL" \
        -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
        -H "Content-Type: application/json" \
        -d '{"automated": false}' \
        --max-time 10 > /dev/null 2>&1; then
        print_status "✅ $func responding"
    else
        print_warning "⚠️  $func may not be responding (this is normal during initial deployment)"
    fi
done

echo ""
print_status "🎉 Sports Data Automation System Deployment Complete!"
echo ""
print_status "Next steps:"
echo "1. Verify cron jobs are active: Check Supabase dashboard > Database > Cron jobs"
echo "2. Monitor function logs: supabase functions logs <function-name>"
echo "3. Check health status: Call sports-data-health-check function"
echo "4. Monitor cron_job_logs table for automated execution results"
echo ""
print_status "Cron Schedule:"
echo "  • Team Stats: Daily at 6 AM UTC"
echo "  • Player Stats: Daily at 7 AM UTC"  
echo "  • Injuries: Every 4 hours"
echo "  • Rosters: Weekly on Mondays at 8 AM UTC"
echo "  • Health Check: Daily at 5 AM UTC"
echo ""