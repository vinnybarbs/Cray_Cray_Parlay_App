# Supabase Edge Function Setup & Deployment

## Overview
This Edge Function fetches odds from the-odds-api and caches them in Supabase, replacing the Express `/cron/refresh-odds` endpoint with a serverless, always-running solution.

## Prerequisites
- Supabase project set up (CLI linked)
- `ODDS_API_KEY` secret configured in Supabase
- `odds_cache` table created in your database
- `pg_cron` extension enabled

## Deployment Steps

### 1. Install Supabase CLI (Local)
```bash
npm install -g supabase
```

### 2. Link Your Supabase Project
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```
Get `YOUR_PROJECT_REF` from your Supabase dashboard URL: `https://app.supabase.com/project/YOUR_PROJECT_REF`

### 3. Verify Edge Function Directory
Function is already created at: `supabase/functions/refresh-odds/index.ts`

Structure should be:
```
supabase/
└── functions/
    └── refresh-odds/
        └── index.ts
```

### 4. Deploy the Edge Function
```bash
supabase functions deploy refresh-odds
```

Expected output:
```
✓ Function deployed successfully
Function URL: https://YOUR_PROJECT_REF.functions.supabase.co/functions/v1/refresh-odds
```

### 5. Set Secrets in Supabase
The function reads from environment variables. Set them via CLI or Supabase Dashboard:

```bash
supabase secrets set ODDS_API_KEY=your_api_key_here
supabase secrets set SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

Or via Supabase Dashboard:
- Go to: **Project Settings → Edge Functions → Secrets**
- Add each secret above

### 6. Enable pg_cron Extension
In Supabase SQL Editor, run:
```sql
-- Enable pg_cron extension (one-time)
create extension if not exists pg_cron;

-- Grant permissions to postgres user
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
```

### 7. Create Cron Job
In Supabase SQL Editor, run the SQL from `database/enable-pg-cron.sql`:

This will create a cron job that:
- Runs every hour (configurable)
- Calls your Edge Function via HTTP
- Logs results to `cron_runs` table

## Testing

### Manual Function Invocation (Local)
```bash
supabase functions invoke refresh-odds --no-verify-jwt
```

### Curl (Remote)
```bash
curl -X POST https://YOUR_PROJECT_REF.functions.supabase.co/functions/v1/refresh-odds \
  -H "Authorization: Bearer YOUR_ANON_KEY_OR_SERVICE_KEY"
```

### Verify Cache Population
```bash
# Query from Supabase
select sport, count(*) as records, max(last_updated) 
from odds_cache 
group by sport;
```

## Monitoring

### Check Cron Execution Logs
```sql
-- View latest cron runs
select cron_id, scheduled_time, success, error_message, response
from cron_runs
order by scheduled_time desc
limit 10;
```

### Monitor Edge Function Logs
Supabase Dashboard:
- **Functions → refresh-odds → Invocations**
- See all executions, errors, and response times

## Troubleshooting

### Function Deployment Fails
- Ensure TypeScript syntax is correct
- Check Deno compatibility (should be automatic for Supabase)
- Try: `supabase functions deploy refresh-odds --no-verify-jwt`

### Cron Not Running
- Verify pg_cron extension is enabled: `select * from pg_extension where extname='pg_cron';`
- Check cron syntax in `enable-pg-cron.sql`
- Review Supabase logs for HTTP errors

### API Rate Limits Hit
- The function has built-in retries and delays
- Check `DELAYS` configuration in `index.ts`
- Monitor `x-requests-remaining` header in logs
- Consider increasing pricing plan if consistently hitting limits

### Cache Not Populated
- Verify `odds_cache` table exists and has correct schema
- Check Edge Function logs for insert errors
- Ensure service role key has insert permissions on `odds_cache`

## Configuration

### Change Cron Schedule
Edit `enable-pg-cron.sql` and update cron expression:
- `'0 * * * *'` = every hour
- `'0 */6 * * *'` = every 6 hours
- `'0 0 * * *'` = daily at midnight
- See: https://en.wikipedia.org/wiki/Cron#CRON_expression

### Change Sports/Markets/Bookmakers
Edit `supabase/functions/refresh-odds/index.ts`:
- `SPORTS` array (line 5)
- `CORE_MARKETS` (line 15)
- `PROP_MARKETS` object (line 17)
- `BOOKMAKERS` (line 36)

## Deployment Checklist

- [ ] Supabase CLI installed and linked
- [ ] `supabase/functions/refresh-odds/index.ts` exists
- [ ] Function deployed: `supabase functions deploy refresh-odds`
- [ ] Secrets set: ODDS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
- [ ] pg_cron extension enabled in database
- [ ] Cron job created via `enable-pg-cron.sql`
- [ ] Manual test successful: `supabase functions invoke refresh-odds`
- [ ] Verified cache population: `select count(*) from odds_cache;`
- [ ] Monitored first scheduled run (check `cron_runs` table)

## Express Route Compatibility

The existing `/cron/refresh-odds` endpoint in `server.js` is still available for manual testing:
```bash
curl -X POST http://localhost:5001/cron/refresh-odds \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: YOUR_CRON_SECRET" \
  -d '{}'
```

Once Edge Function is stable, you can optionally remove the Express route to reduce code complexity.

## Next Steps

1. Deploy Edge Function (step 4)
2. Set secrets (step 5)
3. Enable pg_cron (step 6)
4. Create cron job (step 7)
5. Test and monitor

Questions? Check the Supabase docs: https://supabase.com/docs/guides/functions
