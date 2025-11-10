# Quick Reference: Edge Function Setup

## TL;DR (5-minute setup)

```bash
# 1. Deploy function
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy refresh-odds

# 2. Set secrets via CLI
supabase secrets set \
  ODDS_API_KEY=your_key \
  SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=your_service_key

# 3. Enable pg_cron (paste SQL from database/enable-pg-cron.sql into Supabase SQL Editor)
#    Don't forget to replace YOUR_PROJECT_REF and YOUR_SERVICE_ROLE_KEY!

# 4. Test
supabase functions invoke refresh-odds --no-verify-jwt

# 5. Check cache populated
# SELECT count(*) FROM odds_cache;  (in Supabase SQL Editor)
```

## Key Files

| File | Purpose |
|------|---------|
| `supabase/functions/refresh-odds/index.ts` | Main Edge Function (TypeScript) |
| `supabase/functions/refresh-odds/README.md` | Detailed deployment instructions |
| `database/enable-pg-cron.sql` | SQL to enable pg_cron and schedule job |
| `docs/EDGE_FUNCTION_SETUP.md` | Complete troubleshooting & reference |
| `docs/EDGE_FUNCTION_PLAN.md` | Architecture overview & rationale |

## How It Works

1. **pg_cron scheduler** (in Supabase) triggers every hour
2. **Calls Edge Function** via HTTP POST
3. **Edge Function fetches** odds from the-odds-api
4. **Stores in odds_cache** table
5. **Your app reads** from cache (no more 404s!)

## Verification Commands

### Is function deployed?
```bash
supabase functions list
```
Should show `refresh-odds`

### Did cron job schedule?
```sql
select * from cron.job where jobname = 'refresh-odds-hourly';
```

### Is cache populated?
```sql
select sport, count(*) from odds_cache group by sport;
```

### Did Edge Function run?
Supabase Dashboard → Functions → refresh-odds → Invocations

## Secrets Needed

Set these in Supabase (Project Settings → Edge Functions → Secrets):

1. **ODDS_API_KEY** - from the-odds-api account
2. **SUPABASE_URL** - from Project Settings → API
3. **SUPABASE_SERVICE_ROLE_KEY** - from Project Settings → API

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `pg_cron extension not found` | Run `CREATE EXTENSION pg_cron;` in SQL editor |
| `Unauthorized (401)` | SERVICE_ROLE_KEY wrong or not set |
| `Rate limit exceeded` | Increase delays in index.ts or upgrade API plan |
| `Cache not populating` | Check function logs, verify service role has INSERT |

## Optional: Adjust Schedule

Default: **every hour** (`'0 * * * *'`)

Edit `database/enable-pg-cron.sql` and change the cron expression:
- Every 6 hours: `'0 */6 * * *'`
- Every 30 min: `'*/30 * * * *'`
- Daily: `'0 0 * * *'`

Re-run SQL to update.

## Fallback

If Edge Function fails, Express route still works:
```bash
curl -X POST http://localhost:5001/cron/refresh-odds \
  -H "x-cron-secret: YOUR_SECRET"
```
