# Odds Caching Setup Guide

## Overview
Odds caching dramatically reduces API calls to The Odds API and improves performance by storing odds in Supabase and refreshing them hourly.

## What's Implemented ✅

1. **Database Table**: `odds_cache` table in Supabase
2. **Refresh Endpoint**: `POST /cron/refresh-odds` 
3. **Cache Reading**: Odds agent checks cache first, falls back to live API
4. **Auto-cleanup**: Deletes odds older than 24 hours

## Environment Variables Needed

Add to Railway:
```bash
CRON_SECRET=your-random-secret-here-make-it-long-and-secure
```

Generate a secure secret:
```bash
openssl rand -base64 32
```

## Setup Cron Job (Choose One Method)

### Option 1: Railway Cron (Recommended)

1. Go to Railway → Your Project
2. Click **"New"** → **"Cron Job"**
3. Configure:
   - **Name**: Refresh Odds Cache
   - **Schedule**: `0 * * * *` (every hour)
   - **Command**: 
     ```bash
     curl -X POST https://craycrayparlayapp-production.up.railway.app/cron/refresh-odds \
       -H "Authorization: Bearer $CRON_SECRET" \
       -H "Content-Type: application/json"
     ```
4. Add environment variable `CRON_SECRET` with your secret

### Option 2: External Cron Service (cron-job.org)

1. Go to https://cron-job.org
2. Create free account
3. **Create New Cron Job**:
   - **Title**: Refresh Parlay Odds
   - **URL**: `https://craycrayparlayapp-production.up.railway.app/cron/refresh-odds`
   - **Schedule**: Every 1 hour
   - **Request Method**: POST
   - **Headers**: 
     - `Authorization: Bearer YOUR_CRON_SECRET`
     - `Content-Type: application/json`

### Option 3: GitHub Actions (Free)

Create `.github/workflows/refresh-odds.yml`:

```yaml
name: Refresh Odds Cache

on:
  schedule:
    - cron: '0 * * * *'  # Every hour
  workflow_dispatch:  # Manual trigger

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - name: Call Refresh Endpoint
        run: |
          curl -X POST https://craycrayparlayapp-production.up.railway.app/cron/refresh-odds \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            -H "Content-Type: application/json"
```

Add `CRON_SECRET` to GitHub Secrets.

## How It Works

### 1. Hourly Refresh
- Cron job calls `/cron/refresh-odds`
- Fetches odds for NFL, NBA, MLB, NHL
- Stores in `odds_cache` table
- Cleans up odds older than 24 hours

### 2. User Requests
- User clicks "Get AI Suggestions"
- Odds agent checks cache first (2-hour freshness)
- If cache hit: Returns instantly ⚡
- If cache miss: Fetches from live API (fallback)

### 3. API Usage Reduction
**Before caching:**
- Every user request = 5-10 API calls
- 100 users/day = 500-1000 calls/day
- ~15,000-30,000 calls/month

**After caching:**
- Hourly refresh = 24 calls/day
- User requests = 0 API calls (served from cache)
- ~720 calls/month (97% reduction!)

## Testing

### 1. Test the Refresh Endpoint

```bash
# Set your secret
export CRON_SECRET="your-secret-here"

# Call the endpoint
curl -X POST https://craycrayparlayapp-production.up.railway.app/cron/refresh-odds \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json"
```

Expected response:
```json
{
  "success": true,
  "totalGames": 45,
  "totalOdds": 180,
  "timestamp": "2025-11-06T..."
}
```

### 2. Check Supabase

Go to Supabase → Table Editor → `odds_cache`

You should see rows with:
- `sport`: "americanfootball_nfl", "basketball_nba", etc.
- `bookmaker`: "draftkings", "fanduel", etc.
- `market_type`: "h2h", "spreads", "totals"
- `outcomes`: JSON array with odds
- `fetched_at`: Recent timestamp

### 3. Test User Flow

1. Visit your app
2. Click "Get AI Suggestions"
3. Check Railway logs for: `✅ Cache hit: X games from cache`

## Monitoring

### Check Cache Status

```sql
-- In Supabase SQL Editor
SELECT 
  sport,
  bookmaker,
  COUNT(*) as odds_count,
  MAX(fetched_at) as last_refresh
FROM odds_cache
GROUP BY sport, bookmaker
ORDER BY sport, bookmaker;
```

### Check Cache Age

```sql
SELECT 
  sport,
  COUNT(*) as total_odds,
  MIN(fetched_at) as oldest,
  MAX(fetched_at) as newest,
  EXTRACT(EPOCH FROM (NOW() - MAX(fetched_at)))/3600 as hours_since_refresh
FROM odds_cache
GROUP BY sport;
```

## Troubleshooting

### Cache Not Populating
- Check Railway logs for cron job execution
- Verify `CRON_SECRET` is set correctly
- Test endpoint manually with curl
- Check `ODDS_API_KEY` is set in Railway

### Still Hitting Live API
- Check Railway logs for "Cache hit" vs "Cache empty"
- Verify odds are less than 2 hours old in database
- Check Supabase connection in Railway logs

### Cron Job Not Running
- Verify cron schedule syntax
- Check cron service logs
- Test endpoint manually to ensure it works

## Cost Savings

**The Odds API Pricing:**
- Free tier: 100,000 calls/month
- Paid tier: $50/month for 500,000 calls

**With Caching:**
- ~720 calls/month for refresh
- Stays well within free tier
- Can support 1000s of users without paid tier

## Next Steps

1. ✅ Add `CRON_SECRET` to Railway
2. ✅ Set up cron job (choose one method above)
3. ✅ Test the endpoint manually
4. ✅ Verify cache is populating in Supabase
5. ✅ Monitor for 24 hours to ensure it's working

## Security Notes

- ⚠️ **Never commit `CRON_SECRET` to git**
- ⚠️ Use a strong, random secret (32+ characters)
- ⚠️ The endpoint is protected - only requests with correct secret work
- ⚠️ `SUPABASE_SERVICE_ROLE_KEY` is also sensitive - keep secure

---

**Status**: ✅ Odds caching is fully implemented and ready for cron setup!
