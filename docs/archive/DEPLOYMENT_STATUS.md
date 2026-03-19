# Railway Deployment Status & Next Steps

**Status Date:** November 9, 2025  
**Service:** `craycrayparlayapp-production.up.railway.app`

## ✅ What's Working

### Health Check
- Endpoint: `GET /api/health`
- Status: **200 OK**
- Returns: environment, port, and API key status (odds, openai, serper)
- All APIs configured and ready

### Generate Parlay (Main Feature)
- Endpoint: `POST /api/generate-parlay`
- Status: **200 OK**
- Sample response metadata:
  ```json
  {
    "oddsSource": "DraftKings",
    "fallbackUsed": false,
    "dataQuality": 100,
    "researchedGames": 5,
    "totalGames": 5,
    "timings": {
      "oddsMs": 1207,
      "researchMs": 1200,
      "analysisMs": 18848,
      "postProcessingMs": 6,
      "totalMs": 21396
    }
  }
  ```
- ✅ **Uses cache** (fallbackUsed: false) — indicates cached odds are being served
- ✅ **Can generate parlays** — frontend can now call this endpoint successfully

### Validation Middleware
- All required fields validated: `selectedSports`, `selectedBetTypes`, `numLegs`, `oddsPlatform`, `riskLevel`, `dateRange`
- Request sanitization active
- Rate limiting active (parlayRateLimiter)

## ❌ Issues Found

### Missing Cron Endpoint
- Endpoint: `POST /cron/refresh-odds`
- Status: **404 Not Found**
- Cause: The deployed Railway instance does not have the cron route registered

### Why This Happened
The deployed code is likely from an earlier commit before the cron route was added to `server.js`. The local development environment has the route, but it hasn't been pushed/deployed to Railway yet.

### Solution
1. Commit and push the current code (which includes the cron route) to GitHub
2. Trigger a Railway redeploy (if auto-deploy is enabled, it will redeploy automatically)
3. After redeploy completes, re-run the verification script to confirm `/cron/refresh-odds` is now available

## 🎯 What Needs to Happen

### Immediate (Critical)
1. **Push code to GitHub**
   ```bash
   git add -A
   git commit -m "Add cron/refresh-odds route and Railway deployment config"
   git push origin main
   ```

2. **Monitor Railway redeploy**
   - Go to Railway dashboard
   - Check the "Deployments" tab
   - Wait for the new deployment to complete (status: Success)
   - Check the logs for `Backend server started`

3. **Re-verify cron endpoint**
   ```bash
   node scripts/verify_railway.js
   ```
   Should now show ✅ for cron instead of ⚠️

### Once Cron is Deployed (High Priority)
4. **Seed the cache manually (one-time)**
   ```bash
   curl -X POST https://craycrayparlayapp-production.up.railway.app/cron/refresh-odds \
     -H "Content-Type: application/json" \
     -H "x-cron-secret: $CRON_SECRET" \
     -d '{}'
   ```

5. **Set up automatic cron scheduling**
   - Option A: Use Railway Scheduler (built-in plugin)
     - Add a scheduled task: POST to `/cron/refresh-odds` every 15 minutes (or hourly)
   - Option B: Use external service like EasyCron or AWS EventBridge
   - Option C: Add a cron job in your CI/CD (GitHub Actions)

### Testing the Full Flow (Medium Priority)
6. **Test the deployment from the frontend**
   - Frontend now defaults `API_BASE` to `https://craycrayparlayapp-production.up.railway.app`
   - Open the frontend in a browser
   - Click "Generate Parlay"
   - Should successfully return a generated parlay with cached odds

7. **Monitor initial cron runs**
   - Watch Railway logs for `/cron/refresh-odds` POST requests
   - Check for any errors in the Supabase `odds_cache` table population

## 📋 Verification Commands

### Health Check
```bash
curl -sS https://craycrayparlayapp-production.up.railway.app/api/health | jq
```

### Trigger Cron (Manual One-off)
```bash
CRON_SECRET="your_cron_secret_here"
curl -X POST https://craycrayparlayapp-production.up.railway.app/cron/refresh-odds \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{}' | jq
```

### Generate Parlay (Test Frontend Integration)
```bash
curl -X POST https://craycrayparlayapp-production.up.railway.app/api/generate-parlay \
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

### Run Full Verification Script
```bash
node scripts/verify_railway.js
```

## 📁 Files Changed (Ready for Deploy)

- `server.js` — POST /cron/refresh-odds route registered
- `api/refresh-odds.js` — cron handler (rate-limited, config-driven)
- `Procfile` — Railway startup configuration
- `Dockerfile` — (optional) container image for deployment
- `DEPLOY_RAILWAY.md` — deployment checklist and instructions
- `env.example` — added VITE_API_BASE_URL, CRON_SECRET, Supabase keys
- `src/components/MainApp.jsx` — API_BASE defaults to Railway URL
- `src/AppLegacy.jsx` — API_BASE defaults to Railway URL
- `scripts/verify_railway.js` — verification tool for deployed backend

## 🔒 Required Environment Variables (Set in Railway)

All of these must be set in Railway's environment settings:

- `SUPABASE_URL` — from Supabase dashboard
- `SUPABASE_SERVICE_ROLE_KEY` — from Supabase dashboard (service role, not anon)
- `SUPABASE_ANON_KEY` — from Supabase dashboard (public anon key)
- `ODDS_API_KEY` — from the-odds-api
- `OPENAI_API_KEY` — from OpenAI dashboard
- `SERPER_API_KEY` — from Serper.dev (optional but recommended for research)
- `CRON_SECRET` — your own secure random string (used to protect /cron/refresh-odds)
- `FRONTEND_URL` — (optional) set to your frontend URL if hosted separately
- `NODE_ENV` — set to `production`

## 🎯 Expected Behavior After All Steps

1. ✅ Frontend loads and connects to Railway backend
2. ✅ User clicks "Generate Parlay" button
3. ✅ Frontend POSTs to `https://craycrayparlayapp-production.up.railway.app/api/generate-parlay`
4. ✅ Backend returns generated parlay with cached odds (fallbackUsed: false)
5. ✅ Cron scheduler runs every 15 min and refreshes `odds_cache` in Supabase
6. ✅ No more 404 errors; users can generate parlays successfully

## 🚨 Troubleshooting

### If Cron Still Returns 404 After Redeploy
- Check Railway logs for deployment errors
- Verify the new code includes `app.post('/cron/refresh-odds', ...)`
- Check if deployment rollback occurred (check Deployments tab)
- If needed, manually trigger a new deploy in Railway dashboard

### If Generate-Parlay Returns 404
- Verify the frontend is pointing to the correct `API_BASE` URL
- Check browser console for actual request URL being called
- Verify VITE_API_BASE_URL environment variable is set (or defaults correctly)

### If Cache Isn't Being Used (fallbackUsed: true)
- Verify cron has run at least once (check Railway logs)
- Check `odds_cache` table in Supabase for rows
- Verify SUPABASE_SERVICE_ROLE_KEY is correct (used by cron to write cache)

## 📞 Quick Deploy Checklist

- [ ] Commit code: `git add -A && git commit -m "..."`
- [ ] Push to GitHub: `git push origin main`
- [ ] Monitor Railway redeploy (check dashboard, watch for Success status)
- [ ] Wait ~2-3 minutes for service to restart
- [ ] Run: `node scripts/verify_railway.js`
- [ ] Verify ✅ for health, generate-parlay, and cron
- [ ] Manually seed cache: `curl -X POST ... /cron/refresh-odds`
- [ ] Set up cron scheduler in Railway (every 15 min)
- [ ] Test from frontend: click Generate Parlay, verify success
- [ ] Monitor Railway logs for the first 24 hours
