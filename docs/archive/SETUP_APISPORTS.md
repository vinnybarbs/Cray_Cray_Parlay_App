# 🚀 API-Sports Setup Guide

You're ready to go! Here's how to get real NFL stats flowing into your picks.

---

## Step 1: Add API Key to Railway

1. Go to Railway dashboard: https://railway.app
2. Select your project: `craycrayparlayapp-production`
3. Go to **Variables** tab
4. Add new variable:
   ```
   APISPORTS_API_KEY=your_api_key_here
   ```
5. Click **Deploy** (Railway will restart with new key)

---

## Step 2: Create Database Schema

1. Go to Supabase: https://supabase.com/dashboard
2. Select your project
3. Go to **SQL Editor**
4. Copy and paste: `database/apisports-schema.sql`
5. Click **Run**
6. You should see: "API-Sports schema created successfully!"

---

## Step 3: Populate Initial Data

Once Railway finishes deploying (~3 minutes), run:

```bash
cd ~/Desktop/Cray_Cray_Parlay_App
node scripts/populate-apisports.js
```

**What this does:**
- Fetches all 32 NFL teams
- Gets current standings
- Syncs all injury reports
- Uses ~3-5 API calls

**Expected output:**
```
🏈 API-Sports Initial Data Population
=====================================

Step 1: Syncing NFL Teams...
✅ Synced 32 teams

Step 2: Syncing Current Standings...
✅ Synced 32 team standings

Step 3: Syncing Current Injuries...
✅ Synced 47 injury reports

🎉 Initial Population Complete!
================================
Teams: 32
Standings: 32
Injuries: 47
API Calls Used: 3/100
Remaining Today: 97
```

---

## Step 4: Verify Data

Run these SQL queries in Supabase to verify:

### Check Teams
```sql
SELECT name, apisports_id FROM teams 
WHERE apisports_id IS NOT NULL 
ORDER BY name;
```

### Check Injuries
```sql
SELECT * FROM current_injuries_by_team 
ORDER BY team_name, status;
```

### Check Standings
```sql
SELECT * FROM current_standings 
ORDER BY conference, division, division_rank;
```

---

## Step 5: Test Pick Generation

Generate picks through your app. Check Railway logs for:

```
📊 Gathering real data for AI to prevent hallucinations...
  🏈 Fetching API-Sports data...
    ✓ Found injuries for 4 teams
    ✓ Found API-Sports records for 4 teams

📋 REAL DATA SUMMARY FOR AI:
  Team Records: 4 teams
  News Articles: 12 articles
  Sample Records: Falcons 7-5 (58.3%), Jets 3-9 (25.0%)
  Injuries: Jets - QB Wilson (Questionable - Knee)
```

---

## Step 6: Set Up Daily Sync

### Option A: Manual Sync (Recommended for Testing)
Run whenever you want fresh data:
```bash
curl -X POST https://craycrayparlayapp-production.up.railway.app/api/sync-apisports
```

### Option B: Automated Cron (Coming Soon)
We'll set up a Supabase Edge Function to run daily at 8 AM.

---

## What You'll See Now

### Before (Generic):
```
Tyrod Taylor Over 167.5 Pass Yards catches our eye at -111 
for Atlanta Falcons @ New York Jets. Current pricing appears 
favorable given the game environment and situational context.
```

### After (Data-Driven):
```
Tyrod Taylor Over 167.5 Pass Yards @ New York Jets

STATISTICAL EDGE:
- Falcons: 7-5 (58.3%) | NFC South Rank: #2 | Streak: W2
- Jets: 3-9 (25.0%) | AFC East Rank: #4 | Streak: L5

INJURY IMPACT:
- Jets CB Sauce Gardner: Out - Ankle (top pass defender)
- Jets LB C.J. Mosley: Questionable - Groin (tackles leader)

MATCHUP ADVANTAGE:
- Jets depleted secondary against Taylor's passing attack
- Line at 167.5 undervalues injury impact
- Falcons need to exploit weak pass defense

VALUE: Strong play given defensive injuries
```

---

## API Usage Monitoring

### Check Status
```bash
curl https://craycrayparlayapp-production.up.railway.app/api/sync-apisports/status
```

### Expected Daily Usage:
- **Morning sync**: 3 calls (injuries, standings, schedule)
- **Pick generation**: 0 calls (uses cached data)
- **Post-game**: 5-10 calls (player stats for settled games)
- **Total**: ~15 calls/day of 100 limit

---

## Troubleshooting

### "No teams returned from API"
- Check API key is correct in Railway
- Verify API-Sports subscription is active
- Check quota: https://dashboard.api-sports.io

### "Database schema error"
- Make sure you ran `database/apisports-schema.sql`
- Check all tables exist: teams, players, injuries, standings

### "No data in views"
- Run populate script: `node scripts/populate-apisports.js`
- Wait a few seconds for data to populate
- Refresh your query

### "Injuries not showing in picks"
- Check Railway logs for "Found injuries for X teams"
- Verify teams table has apisports_id mapped
- Run sync: `POST /api/sync-apisports`

---

## Next Steps

1. ✅ **Today**: Get data flowing, test picks
2. ⏳ **This Week**: Monitor API usage, tune prompts
3. 🔮 **Next Week**: Add player props with detailed stats
4. 🎯 **Future**: Historical performance analysis, learning integration

---

## Support

If you run into issues:
1. Check Railway logs for errors
2. Verify Supabase schema is complete
3. Test API key with: https://v1.american-football.api-sports.io/status

---

**You're all set! Real NFL data is now powering your AI picks.** 🏈📊
