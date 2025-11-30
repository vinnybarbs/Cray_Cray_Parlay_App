# Fix 401 Error on ingest-standings Cron Job

## Problem
`ingest-standings` Edge Function returns 401 when called by cron because the cron job isn't sending proper authorization headers.

## Solution

### Option 1: Update Cron Job to Send Auth (Recommended)

Run this in Supabase SQL Editor to fix the cron job:

```sql
-- Find and update the ingest-standings cron job
SELECT cron.unschedule('ingest-standings-hourly');

-- Recreate with proper auth headers
SELECT cron.schedule(
  'ingest-standings-hourly',
  '0 * * * *',  -- Every hour
  $$
  SELECT net.http_post(
    url:='https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/ingest-standings?sport=NFL&season=2025&seasonType=2',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    )
  );
  $$
);
```

### Option 2: Make Function Publicly Accessible

If you don't want to deal with auth, you can disable verification for this specific function:

1. Go to Supabase Dashboard → Edge Functions
2. Find `ingest-standings`
3. Settings → Disable "Verify JWT"

⚠️ **Security Note:** This makes the function publicly callable. Add rate limiting if you do this.

### Option 3: Use Function URL with Anon Key

```sql
SELECT cron.schedule(
  'ingest-standings-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url:='https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/ingest-standings?sport=NFL&season=2025&seasonType=2',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'YOUR_SUPABASE_ANON_KEY_HERE'
    )
  );
  $$
);
```

## Why This Happens

Supabase Edge Functions require authentication by default. When called from:
- **Browser**: Sends anon key automatically
- **Server**: Sends service role key
- **Cron (pg_cron)**: Needs explicit configuration

The `check-parlay-outcomes` function works because it's configured with proper auth.

## Check Current Cron Jobs

```sql
SELECT * FROM cron.job WHERE jobname LIKE '%standings%';
```

## View Cron Logs

```sql
SELECT * 
FROM cron.job_run_details 
WHERE jobname LIKE '%standings%' 
ORDER BY start_time DESC 
LIMIT 10;
```
