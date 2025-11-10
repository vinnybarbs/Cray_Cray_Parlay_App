# Supabase Edge Function Implementation Plan

## Current Architecture (Express Server)
```
Express /cron/refresh-odds (POST)
  ├─ Fetches odds via the-odds-api
  ├─ Writes to Supabase odds_cache
  └─ Requires server to be running + scheduled trigger
```

## Proposed Architecture (Supabase Edge Function + pg_cron)
```
pg_cron scheduler (hourly)
  ├─ Triggers Edge Function via HTTP
  ├─ Edge Function fetches odds via the-odds-api
  ├─ Writes to Supabase odds_cache
  └─ Completely serverless + always runs
```

## Benefits of Migration
✅ **No server dependency** — runs even if your Express server is down  
✅ **Native database integration** — writes directly to Supabase  
✅ **Built-in scheduling** — pg_cron instead of external scheduler  
✅ **Cost efficient** — Edge Functions are free/cheap tier friendly  
✅ **Monitoring** — Supabase Dashboard shows all runs and logs  
✅ **Scalability** — automatically handles load  

## Implementation Strategy

### Phase 1: Create & Deploy Edge Function
1. Create TypeScript Edge Function in `supabase/functions/refresh-odds/`
2. Port the odds-fetching logic from `api/refresh-odds.js`
3. Deploy to Supabase

### Phase 2: Set Up pg_cron
1. Enable `pg_cron` extension in Supabase
2. Create cron job that calls the Edge Function via HTTP
3. Set schedule (e.g., every hour)

### Phase 3: Test & Verify
1. Manually invoke Edge Function
2. Monitor cache population in Supabase
3. Verify agents read from cache

### Phase 4: Deprecate Express Route (Optional)
1. Keep Express `/cron/refresh-odds` for manual testing
2. Eventually remove once Edge Function is proven stable

## Sports & Markets Configuration

**Sports to track:** (from your config)
- NFL (americanfootball_nfl)
- NCAAF (americanfootball_ncaaf)
- NBA (basketball_nba)
- NHL (icehockey_nhl)
- EPL (soccer_epl)

**Bookmakers:** DraftKings, FanDuel (configured via env)

**Markets:**
- Core: h2h (moneyline), spreads, totals
- Player Props: NFL & NBA only (10+ markets each)

**API Calls Per Run:**
- 1 request: sports availability check
- 5 sports × 1 core request = 5 requests
- 2 sports (NFL/NBA) × player props (3-5 requests each) = ~10 requests
- **Total: ~16 requests per run**
- **Hourly: 16 requests**
- **Daily: 16 × 24 = 384 requests** (under $50/month plan)

## Files to Create

1. `supabase/functions/refresh-odds/index.ts` — Edge Function implementation
2. `supabase/functions/refresh-odds/README.md` — Deployment instructions
3. `database/enable-pg-cron.sql` — SQL to enable and schedule cron
4. `docs/EDGE_FUNCTION_SETUP.md` — Complete setup guide

## Next Steps

1. Review and approve this architecture
2. I'll create the Edge Function TypeScript code
3. Provide SQL to enable pg_cron and schedule it
4. Test locally, then deploy to Supabase
