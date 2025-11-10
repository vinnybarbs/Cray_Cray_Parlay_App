CRON / odds cache seed README

Purpose
- Explain how to run the odds cache refresh cron locally and in production.
- Show recommended settings to minimize Odds API calls while keeping cache fresh.

Overview
- The `/cron/refresh-odds` endpoint will fetch odds for configured sports and upsert them into the `odds_cache` table in Supabase.
- By default, only DraftKings and FanDuel are fetched to minimize API usage.
- The endpoint is protected by `CRON_SECRET` (send as `Authorization: Bearer <CRON_SECRET>`).

Environment
- Required env vars (local or in deployment platform):
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` (server-only/service role)
  - `ODDS_API_KEY` (The Odds API key)
  - `CRON_SECRET` (shared secret for the cron endpoint)
  - Optional: `BOOKMAKERS` (comma-separated list, defaults to `draftkings,fanduel`)
  - Optional: `ODDS_ALLOW_LIVE_FETCH` (set to `true` to allow live fallback for debugging; default: unset/false)

Recommended schedule
- Refresh every hour during peak times (e.g., every hour from 08:00 - 03:00 local), and every 3-4 hours off-peak.
- Example cron expression for hourly runs: `0 * * * *` (every hour at minute 0).
- If using Railway/Vercel schedulers, configure a POST request to `https://<your-host>/cron/refresh-odds` with the `Authorization` header.

How to run locally
1) Create a local `.env.local` with the required keys (do NOT commit this file):

```bash
SUPABASE_URL="https://your-supabase"
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
ODDS_API_KEY="<the-odds-api-key>"
CRON_SECRET="<some-secret>"
BOOKMAKERS="draftkings,fanduel"
```

2) Start the backend:

```bash
export $(grep -v '^#' .env.local | xargs)
npm run server:dev
```

3) Trigger the cron manually (once):

```bash
CRON_SECRET=$(grep '^CRON_SECRET=' .env.local | cut -d'=' -f2-)
curl -X POST http://localhost:5001/cron/refresh-odds -H "Authorization: Bearer $CRON_SECRET"
```

Monitoring & logs
- The cron handler emits structured logs showing per-sport fetch counts, API rate headers (`x-requests-remaining`), and a final run summary.
- The handler will attempt to write a `cron_runs` row to Supabase (if the table exists). This is optional and non-fatal.
- If you want persistent monitoring, create a `cron_runs` table with columns: `run_at timestamptz, total_games integer, total_odds integer, nfl_props_games integer, duration_ms integer, bookmakers text`.

Notes
- The system enforces cache-first and cache-only behavior for the odds agent by default. The agent will not fall back to live Odds API calls unless `ODDS_ALLOW_LIVE_FETCH=true` is set for debugging.
- Keep your `ODDS_API_KEY` private and avoid running the cron too frequently to conserve quota.

Contact
- For help integrating with Railway/Vercel scheduled jobs or setting env vars, attach deployment docs or give me access to the service details and I'll draft the exact steps.
