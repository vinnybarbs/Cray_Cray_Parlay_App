# Complete Supabase Edge Function Setup Guide

## Problem We're Solving

Currently, odds caching depends on:
1. An external scheduler (Railway, EasyCron, etc.) calling your Express server
2. Your Express server being online and running
3. Manual restart if the server crashes

**New approach:** Supabase Edge Functions + pg_cron
- ✅ Serverless (always available)
- ✅ No external scheduler needed
- ✅ Built-in database integration
- ✅ Automatic retry on failure
- ✅ Observable through Supabase Dashboard

## Architecture Overview

```
Your App (Railway)                   Supabase (Hosted)
┌─────────────────────────────────┬──────────────────────────┐
│                                 │                          │
│  Express Server                 │  pg_cron (scheduler)     │
│  ├─ /api/health                 │  ├─ Runs every hour      │
│  ├─ /api/generate-parlay  ◄─────┼──┤                       │
│  └─ /cron/refresh-odds          │  │ ┌─────────────────┐   │
│     (optional now)              │  └─►│ Edge Function   │   │
│                                 │    │ refresh-odds    │   │
│                                 │    └────────┬────────┘   │
│                                 │            │              │
│                                 │    ┌───────▼────────┐    │
│                                 │    │  odds_cache    │    │
│                                 │    │  table         │    │
│                                 │    └────────────────┘    │
│                                 │                          │
└─────────────────────────────────┴──────────────────────────┘
         ▲ Reads from cache (SELECT)
         │
     Your Users
```

## Implementation Steps

### Step 1: Deploy Edge Function to Supabase

#### 1.1 Install CLI (if not already installed)
```bash
npm install -g supabase
```

#### 1.2 Authenticate with Supabase
```bash
supabase login
```
This opens a browser to generate an access token.

#### 1.3 Link Your Supabase Project
```bash
supabase link --project-ref YOUR_PROJECT_REF
```

**Where to find YOUR_PROJECT_REF:**
- Go to Supabase Dashboard
- URL format: `https://app.supabase.com/project/YOUR_PROJECT_REF`
- Example: `pcjhulzyqmhrhsrgvwvx`

#### 1.4 Deploy the Function
```bash
supabase functions deploy refresh-odds
```

**Expected output:**
```
✓ Function deployed successfully
Function URL: https://YOUR_PROJECT_REF.functions.supabase.co/functions/v1/refresh-odds
```

### Step 2: Configure Secrets in Supabase

The Edge Function needs access to:
- Your Odds API key
- Your Supabase connection details

#### Option A: Via CLI (Recommended)
```bash
supabase secrets set \
  ODDS_API_KEY=sk_live_xxxxx \
  SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...
```

#### Option B: Via Supabase Dashboard
1. Go to: **Project Settings** (bottom left) → **Edge Functions** → **Secrets**
2. Click **Add Secret** for each:
   - `ODDS_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

**Where to find these values:**
- **ODDS_API_KEY**: Your the-odds-api account
- **SUPABASE_URL**: Dashboard → Project Settings → API
- **SUPABASE_SERVICE_ROLE_KEY**: Dashboard → Project Settings → API (labeled "service_role")

### Step 3: Enable pg_cron in Database

In your Supabase Dashboard:
1. Go to: **SQL Editor**
2. Click **New Query**
3. Copy and run the SQL from: `database/enable-pg-cron.sql`

Key parts:
```sql
-- Enable the extension
create extension if not exists pg_cron;

-- Create logging table
create table if not exists cron_runs (...);

-- Schedule the cron job
select cron.schedule(
  'refresh-odds-hourly',
  '0 * * * *',  -- every hour
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.functions.supabase.co/functions/v1/refresh-odds',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'),
    body := '{}',
    timeout_milliseconds := 300000
  );
  $$
);
```

**Important:** Replace `YOUR_PROJECT_REF` and `YOUR_SERVICE_ROLE_KEY` in the SQL before running.

### Step 4: Test the Edge Function

#### Test 1: Manual Invocation (Local)
```bash
supabase functions invoke refresh-odds --no-verify-jwt
```

Expected response:
```json
{
  "status": "success",
  "totalGames": 45,
  "totalOddsInserted": 180,
  "duration": 5423
}
```

#### Test 2: Check Cache Population
```bash
# In Supabase SQL Editor, run:
select 
  sport, 
  count(*) as records, 
  max(last_updated) as most_recent
from odds_cache
group by sport
order by records desc;
```

Expected: Rows for each sport with game count and recent timestamp.

#### Test 3: Verify Agents Read from Cache
```bash
# Call your generate-parlay endpoint and check metadata
curl -X POST http://localhost:5001/api/generate-parlay \
  -H "Content-Type: application/json" \
  -d '{
    "numLegs": 3,
    "riskLevel": "Medium",
    "selectedSports": ["NFL"],
    "selectedBetTypes": ["Moneyline/Spread"],
    "oddsPlatform": "DraftKings",
    "dateRange": 1
  }' | jq '.metadata'
```

Should show: `"fallbackUsed": false`

### Step 5: Monitor Cron Execution

#### View Scheduled Jobs
```sql
-- In Supabase SQL Editor
select * from cron.job;
```

#### View Execution Logs
```sql
-- In Supabase SQL Editor (if logging cron_runs)
select * from cron_runs order by executed_at desc limit 20;
```

#### View Function Invocation Logs
In Supabase Dashboard:
- Go to: **Functions** → **refresh-odds** → **Invocations**
- See all successful and failed runs
- View execution time and response payload

## Configuration Reference

### Cron Schedule Expressions

| Expression | Schedule | Use Case |
|---|---|---|
| `'0 * * * *'` | Every hour | Default (good balance) |
| `'0 */6 * * *'` | Every 6 hours | Reduce API quota usage |
| `'0 0 * * *'` | Daily at midnight | Minimal updates |
| `'*/30 * * * *'` | Every 30 minutes | Frequent updates (high quota) |
| `'0 9-17 * * 1-5'` | 9am-5pm weekdays | Business hours only |

Edit in `database/enable-pg-cron.sql` and re-run to change.

### API Request Configuration

In `supabase/functions/refresh-odds/index.ts`:

```typescript
const DELAYS = {
  betweenSports: 2000,    // 2s between sports
  betweenProps: 1500,     // 1.5s between prop calls
  afterAvailability: 1000  // 1s after availability check
};
```

Increase delays if hitting rate limits; decrease for faster execution.

### Sports & Markets

Edit these constants in `index.ts`:

```typescript
const SPORTS = [
  "americanfootball_nfl",
  "americanfootball_ncaaf",
  "basketball_nba",
  "icehockey_nhl",
  "soccer_epl"
];

const PROP_MARKETS = {
  americanfootball_nfl: [...],
  basketball_nba: [...]
};
```

After changes, redeploy:
```bash
supabase functions deploy refresh-odds
```

## Troubleshooting

### Cron Job Not Running

**Check 1: Is pg_cron enabled?**
```sql
select * from pg_extension where extname='pg_cron';
```
Should return one row. If not, run:
```sql
create extension if not exists pg_cron;
```

**Check 2: Is the job scheduled?**
```sql
select * from cron.job where jobname = 'refresh-odds-hourly';
```
Should return exactly one row.

**Check 3: Did the Edge Function deploy?**
```bash
supabase functions list
```
Should show `refresh-odds` in the list.

### Edge Function Failing

**Check logs:**
```
Supabase Dashboard → Functions → refresh-odds → Invocations
```

**Common errors:**
- "ODDS_API_KEY not set" → Secret not configured correctly
- "Cannot POST to URL" → SERVICE_ROLE_KEY wrong or expired
- "Rate limit exceeded" → Reduce request frequency, increase delays

### Cache Not Populating

**Check:**
1. Edge Function is deployed and secrets are set
2. `odds_cache` table exists: `select count(*) from odds_cache;`
3. Service role key has INSERT permissions on `odds_cache`
4. Cron job ran: Check `cron.log` or function invocation logs

**Debug:**
```bash
# Manually invoke function and check response
supabase functions invoke refresh-odds --no-verify-jwt

# Check for detailed error
supabase functions invoke refresh-odds --no-verify-jwt | jq .
```

## Monitoring & Alerts

### Set Up Email Alerts (Optional)

Supabase doesn't have built-in alerts, but you can:

1. **Query-based checks** in your app:
   ```sql
   -- Alert if cache older than 2 hours
   select count(*) from odds_cache 
   where last_updated < now() - interval '2 hours';
   ```

2. **Check function success rate**:
   - Monitor in Supabase Dashboard
   - If failures occur, check logs and error details

3. **Monitor API quota**:
   - The Edge Function logs `x-requests-remaining`
   - Adjust schedule if quota is depleting faster than expected

## Rollback Plan

If Edge Function has issues, you can temporarily fall back to the Express route:

```bash
# Use your Express server's /cron/refresh-odds endpoint
curl -X POST https://craycrayparlayapp-production.up.railway.app/cron/refresh-odds \
  -H "x-cron-secret: YOUR_CRON_SECRET"
```

Or disable the cron job:
```sql
select cron.unschedule('refresh-odds-hourly');
```

Then redeploy Edge Function with fix:
```bash
# Make changes to supabase/functions/refresh-odds/index.ts
supabase functions deploy refresh-odds

# Re-enable cron
select cron.schedule(...);
```

## Next Steps

1. ✅ Deploy Edge Function
2. ✅ Configure secrets
3. ✅ Enable pg_cron and schedule job
4. ✅ Test manually
5. ✅ Wait for first scheduled run (check logs)
6. ✅ Verify cache population
7. ✅ Monitor for 24 hours
8. ✅ Optional: Remove Express `/cron/refresh-odds` route

---

**Questions?**
- Supabase Edge Functions docs: https://supabase.com/docs/guides/functions
- pg_cron docs: https://github.com/citusdata/pg_cron
- Odds API docs: https://the-odds-api.com/docs/
