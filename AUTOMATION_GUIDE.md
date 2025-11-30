# Automation Guide

All automated tasks for Cray Cray Parlay App using Supabase `pg_cron`.

## Prerequisites

1. **Enable Extensions in Supabase Dashboard:**
   - Go to Database → Extensions
   - Enable `pg_cron` 
   - Enable `pg_net`

2. **Railway Backend Must Be Running:**
   - URL: `https://craycrayparlayapp-production.up.railway.app`
   - All cron jobs call Railway endpoints

## Automated Tasks

### 1. Daily Data Sync (API-Sports)
**Runs:** Every day at 6 AM PT (14:00 UTC)  
**Script:** `supabase/migrations/setup_apisports_cron.sql`  
**Endpoint:** `POST /api/sync-apisports?type=daily`

**What it does:**
- Syncs NFL standings (1 call)
- Syncs current injuries (34 calls, one per team)
- Updates database with latest data

**API Usage:** ~35 calls/day

---

### 1.5. News Summarization (Background Processing)
**Runs:** Every day at 7 AM PT (15:00 UTC)  
**Script:** `supabase/migrations/setup_news_summarization_cron.sql`  
**Endpoint:** `POST /api/cron/summarize-news`

**What it does:**
- Fetches unsummarized news from last 24h
- Uses OpenAI (gpt-4o-mini) to extract betting-relevant insights
- Stores summaries in `news_articles` table
- Reduces prompt size from 27k → ~3k tokens
- AI gets pre-computed insights (not raw HTML)

**API Usage:** ~5-10 OpenAI calls/day (gpt-4o-mini = $0.01-0.02/day)

---

### 2. Weekly Stats Sync (API-Sports)
**Runs:** Every Tuesday at 3 AM PT (11:00 UTC)  
**Script:** `supabase/migrations/setup_weekly_stats_cron.sql`  
**Endpoint:** `POST /api/sync-apisports?type=weekly`

**What it does:**
- Fetches all season games (1 call)
- Syncs NEW games only (smart incremental)
- Updates team stats per game
- Updates player stats per game

**API Usage:** ~10-30 calls/week (depends on new games)

---

### 3. Parlay Outcome Checking
**Runs:** Every day at 3 AM PT (11:00 UTC)  
**Script:** `supabase/migrations/setup_parlay_check_cron.sql`  
**Endpoint:** `POST /api/cron/check-parlays`

**What it does:**
- Checks all pending parlays
- Fetches final scores from The Odds API
- Determines win/loss/push for each leg
- Updates parlay status and profit/loss
- No API limits (use cached/live odds)

**API Usage:** Minimal (uses odds cache)

---

## Setup Instructions

### First-Time Setup

1. **Enable Extensions:**
   ```sql
   -- In Supabase SQL Editor
   CREATE EXTENSION IF NOT EXISTS pg_cron;
   CREATE EXTENSION IF NOT EXISTS pg_net;
   ```

2. **Run All Cron Setup Scripts:**
   
   Copy and paste each script into Supabase SQL Editor:
   - `setup_apisports_cron.sql`
   - `setup_weekly_stats_cron.sql`
   - `setup_parlay_check_cron.sql`

3. **Verify Jobs Are Running:**
   ```sql
   -- Check all scheduled jobs
   SELECT * FROM cron.job;
   
   -- Check recent executions
   SELECT * FROM cron.job_run_details 
   ORDER BY start_time DESC 
   LIMIT 20;
   ```

### Verify Individual Jobs

**API-Sports Daily Sync:**
```sql
SELECT * FROM cron.job WHERE jobname = 'apisports-daily-sync';
SELECT * FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'apisports-daily-sync') 
ORDER BY start_time DESC LIMIT 5;
```

**API-Sports Weekly Sync:**
```sql
SELECT * FROM cron.job WHERE jobname = 'apisports-weekly-stats';
SELECT * FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'apisports-weekly-stats') 
ORDER BY start_time DESC LIMIT 5;
```

**Parlay Outcome Check:**
```sql
SELECT * FROM cron.job WHERE jobname = 'parlay-outcome-check';
SELECT * FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'parlay-outcome-check') 
ORDER BY start_time DESC LIMIT 5;
```

---

## Manual Triggers (Testing)

**Trigger Daily Sync:**
```sql
SELECT net.http_post(
  url:='https://craycrayparlayapp-production.up.railway.app/api/sync-apisports?type=daily',
  headers:='{"Content-Type": "application/json"}'::jsonb,
  body:='{}'::jsonb
);
```

**Trigger Weekly Sync:**
```sql
SELECT net.http_post(
  url:='https://craycrayparlayapp-production.up.railway.app/api/sync-apisports?type=weekly',
  headers:='{"Content-Type": "application/json"}'::jsonb,
  body:='{}'::jsonb
);
```

**Trigger Parlay Check:**
```sql
SELECT net.http_post(
  url:='https://craycrayparlayapp-production.up.railway.app/api/cron/check-parlays',
  headers:='{"Content-Type": "application/json"}'::jsonb,
  body:='{}'::jsonb
);
```

---

## Troubleshooting

### Job Not Running?

1. **Check if job exists:**
   ```sql
   SELECT * FROM cron.job WHERE jobname = 'your-job-name';
   ```

2. **Check execution history:**
   ```sql
   SELECT * FROM cron.job_run_details 
   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'your-job-name')
   ORDER BY start_time DESC;
   ```

3. **Look for errors:**
   ```sql
   SELECT * FROM cron.job_run_details 
   WHERE status = 'failed'
   ORDER BY start_time DESC;
   ```

### Remove and Recreate Job

```sql
-- Remove job
SELECT cron.unschedule('your-job-name');

-- Then re-run the setup script
```

---

## API Quota Summary

**Daily Usage:**
- Daily sync: 35 calls
- Weekly sync: ~10-30 calls/week (~5 calls/day average)
- Parlay checking: minimal
- **Total: ~40 calls/day average**

**With 7500/day limit:** You're using less than 1% of your quota! 🎉

---

## Schedule Summary

| Time (PT) | Task | Endpoint |
|-----------|------|----------|
| 3:00 AM | Check Parlay Outcomes | `/api/cron/check-parlays` |
| 3:00 AM Tuesday | Weekly Stats Sync | `/api/sync-apisports?type=weekly` |
| 6:00 AM | Daily Data Sync | `/api/sync-apisports?type=daily` |

---

## Notes

- All times are in UTC in the cron schedule, converted from PT
- PT = UTC - 8 hours (PST) or UTC - 7 hours (PDT)
- Supabase `pg_cron` uses standard cron syntax: `minute hour day month weekday`
- Jobs run on Supabase infrastructure, not your server
- Railway backend must be running for jobs to work
