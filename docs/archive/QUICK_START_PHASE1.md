# Phase 1: Quick Start Guide

## 5-Minute Deployment

### Step 1: Database Schema (2 minutes)
```bash
# Go to: https://supabase.com/dashboard/project/pcjhulzyqmhrhsrgvwvx/sql/new
# Copy/paste: database/phase1_game_outcomes_schema.sql
# Click "Run"
# ✅ Creates: game_results, ai_suggestions, team_aliases tables
```

### Step 2: Deploy Edge Function (1 minute)
```bash
cd /Users/vincentmorello/Desktop/Cray_Cray_Parlay_App
npx supabase functions deploy check-outcomes
# ✅ Function deployed to Supabase
```

### Step 3: Schedule Cron Jobs (2 minutes)
```sql
-- In Supabase SQL Editor, run:

SELECT cron.schedule(
  'check-outcomes-midnight',
  '0 0 * * *',
  $$
    SELECT net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/check-outcomes',
      headers := jsonb_build_object(
        'Authorization', 
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzOTg1MTUsImV4cCI6MjA3Nzk3NDUxNX0.1O92kXamxlOLuBnF0H-pNUPxXnd2bxLqToKlqobH5Wc'
      )
    );
  $$
);

SELECT cron.schedule(
  'check-outcomes-morning',
  '0 6 * * *',
  $$
    SELECT net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/check-outcomes',
      headers := jsonb_build_object(
        'Authorization', 
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzOTg1MTUsImV4cCI6MjA3Nzk3NDUxNX0.1O92kXamxlOLuBnF0H-pNUPxXnd2bxLqToKlqobH5Wc'
      )
    );
  $$
);

-- ✅ Runs at midnight and 6am daily
```

### Done! ✅

Backend already has the code (api/suggest-picks.js updated).
Railway will auto-deploy on next push.

---

## Test It (Manual Trigger)

```bash
# Manually trigger Edge Function to test
curl -X POST "https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/check-outcomes" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzOTg1MTUsImV4cCI6MjA3Nzk3NDUxNX0.1O92kXamxlOLuBnF0H-pNUPxXnd2bxLqToKlqobH5Wc"

# Should return:
# {"status":"accepted","message":"Outcome checking started in background",...}
```

---

## Check Results

```sql
-- See cached games
SELECT * FROM game_results ORDER BY created_at DESC LIMIT 10;

-- See AI suggestions
SELECT * FROM ai_suggestions ORDER BY created_at DESC LIMIT 10;

-- Model win rate
SELECT 
  COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 / 
  NULLIF(COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')), 0) as win_rate
FROM ai_suggestions
WHERE resolved_at IS NOT NULL;

-- Check cron logs
SELECT * FROM cron_job_logs WHERE job_name = 'check-outcomes' ORDER BY created_at DESC LIMIT 5;
```

---

## What Happens Next

1. **Today**: Generate some picks (they're stored in ai_suggestions)
2. **Tomorrow midnight**: Edge Function runs automatically
3. **Tomorrow morning**: Check ai_suggestions table - outcomes updated!
4. **End of week**: 100+ suggestions tracked, win rate calculated

---

## Verification Checklist

- [ ] Tables created (game_results, ai_suggestions, team_aliases)
- [ ] Edge Function deployed (check-outcomes)
- [ ] Cron jobs scheduled (midnight + 6am)
- [ ] Generate test picks (creates ai_suggestions)
- [ ] Manually trigger function (test ESPN fetching)
- [ ] Check game_results table (games cached?)
- [ ] Check ai_suggestions table (outcomes updated?)

---

## Troubleshooting

### No games cached
```sql
-- Manually trigger for specific date
-- Check ESPN scoreboard directly:
-- http://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20241126
```

### Suggestions not resolving
```sql
-- Check if game_results exist
SELECT * FROM game_results WHERE home_team ILIKE '%Chiefs%';

-- Check team name matching
SELECT * FROM team_aliases WHERE canonical_name ILIKE '%Kansas%';

-- If needed, add alias:
INSERT INTO team_aliases (canonical_name, alias, sport) 
VALUES ('Kansas City Chiefs', 'KC', 'NFL');
```

### Cron not running
```sql
-- Check cron status
SELECT * FROM cron.job;

-- Check logs
SELECT * FROM cron_job_logs ORDER BY created_at DESC LIMIT 10;

-- If missing, recreate schedule (see Step 3 above)
```

---

## Quick Reference

**Edge Function URL**:
`https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/check-outcomes`

**Anon Key**:
`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzOTg1MTUsImV4cCI6MjA3Nzk3NDUxNX0.1O92kXamxlOLuBnF0H-pNUPxXnd2bxLqToKlqobH5Wc`

**Supabase Dashboard**:
https://supabase.com/dashboard/project/pcjhulzyqmhrhsrgvwvx

**ESPN Scoreboard Example**:
http://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20241126

---

## Success! 🎉

You now have:
- ✅ Automatic game result caching
- ✅ AI suggestion tracking
- ✅ Model performance metrics
- ✅ Learning loop foundation

**See PHASE1_IMPLEMENTATION_SUMMARY.md for full details**
