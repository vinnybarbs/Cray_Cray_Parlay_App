# Testing NFL Stats Integration

## Quick Test Steps

### 1. Verify API Key Configuration
```bash
node check-api-keys.js
```

**Expected Output:**
```
✅ Configured APISPORTS_API_KEY (742fae24...)
   Player Verification: ✅ Enabled
```

### 2. Start the Server
```bash
npm run dev
```

**Look for in console:**
```
✅ NFL Stats service initialized
Server running on port 5001
```

### 3. Test NFL Stats Endpoint
In another terminal:
```bash
curl http://localhost:5001/debug/nfl-stats
```

**Expected Response:**
```json
{
  "status": "ok",
  "service": "NFL Stats",
  "apiKey": "configured",
  "stats": {
    "cacheSize": 0,
    "cacheHits": 0,
    "cacheMisses": 0,
    "apiCalls": 0,
    "hitRate": "0%"
  },
  "timestamp": "2025-10-15T..."
}
```

### 4. Generate an NFL Parlay

**Via Frontend:**
1. Open http://localhost:3001
2. Select:
   - Sport: NFL
   - Bet Types: Moneyline/Spread
   - Number of Legs: 3
   - Risk Level: Medium
3. Click "Generate Parlay"

**Via API (curl):**
```bash
curl -X POST http://localhost:5001/api/generate-parlay \
  -H "Content-Type: application/json" \
  -d '{
    "selectedSports": ["NFL"],
    "selectedBetTypes": ["Moneyline/Spread"],
    "numLegs": 3,
    "oddsPlatform": "DraftKings",
    "aiModel": "openai",
    "riskLevel": "Medium",
    "dateRange": 1
  }'
```

### 5. Check Console Logs

**What to Look For:**

✅ **Success - Using Real Stats:**
```
🔍 PHASE 2: ENHANCED RESEARCH
✅ NFL Stats service initialized
📊 Researching top 9 games with moderate depth
  🔍 Researching: Patriots @ Bills (moderate depth)
    📊 Using NFL Stats API for real data
    📊 Fetching stats for Patriots @ Bills
    ✅ NFL stats retrieved successfully
```

❌ **Fallback - Using Google Search:**
```
  🔍 Researching: Patriots @ Bills (moderate depth)
    ⚠️ NFL stats unavailable, falling back to Serper
```

### 6. Verify Parlay Output

**Check the reasoning section for real stats:**

✅ **Good (Real Stats):**
```
**📊 TEAM STATS & RECORDS:**

**New England Patriots** (7-3):
  • Points/Game: 24.8 (Allowed: 19.2)
  • Total Yards/Game: 352.4
  • Passing Yards/Game: 245.6
  • Rushing Yards/Game: 106.8
```

❌ **Fallback (Google Search):**
```
Context: Patriots injury report shows... recent performance...
```

## Troubleshooting

### Problem: "NFL Stats service not available"

**Check 1: File exists**
```bash
ls -la lib/services/nfl-stats.js
```

**Check 2: No syntax errors**
```bash
node -c lib/services/nfl-stats.js
```

### Problem: "API-Sports key not configured"

**Check 1: Key in .env.local**
```bash
grep APISPORTS .env.local
```

**Check 2: Server loaded it**
```bash
node check-api-keys.js
```

**Fix:**
```bash
# Add to .env.local
echo "APISPORTS_API_KEY=your_key_here" >> .env.local

# Restart server
npm run dev
```

### Problem: "Failed to fetch team stats"

**Check 1: API rate limit**
```bash
curl http://localhost:5001/debug/nfl-stats
```

Look at `apiCalls` - if > 100, you've hit daily limit.

**Check 2: Test API key directly**
```bash
curl -H "x-rapidapi-key: YOUR_KEY" \
     -H "x-rapidapi-host: v1.american-football.api-sports.io" \
     "https://v1.american-football.api-sports.io/teams?league=1&season=2024"
```

**Check 3: Network/firewall**
```bash
ping v1.american-football.api-sports.io
```

### Problem: Still seeing Google search results

**Possible causes:**
1. Not an NFL game (check sport_key)
2. API error triggered fallback
3. Stats service not initialized

**Debug:**
1. Check console for "Using NFL Stats API" message
2. If missing, check for error messages
3. Verify game is NFL: `sport_key: 'americanfootball_nfl'`

## Expected API Call Pattern

### First Parlay (Cold Cache):
```
Request 1: /teams (find team IDs) - 2 teams
Request 2: /standings (get records) - 1 call
Request 3: /teams/statistics (team stats) - 2 teams
Request 4: /injuries (injury report) - 1 call

Total: ~6 API calls per game
For 3-leg parlay: ~18 API calls
```

### Second Parlay (Warm Cache):
```
All data cached (1 hour TTL)
Total: 0 API calls
```

### Cache Stats After 3 Parlays:
```bash
curl http://localhost:5001/debug/nfl-stats
```

Expected:
```json
{
  "stats": {
    "cacheSize": 15,
    "cacheHits": 30,
    "cacheMisses": 18,
    "apiCalls": 18,
    "hitRate": "62.5%"
  }
}
```

## Performance Comparison

### Before (Google Search):
- ⏱️ 3-5 seconds per game
- 📊 Variable quality data
- ❌ Rate limited by Serper (300 qps)

### After (API-Sports):
- ⏱️ 1-2 seconds per game (first time)
- ⏱️ <100ms per game (cached)
- 📊 Consistent, accurate data
- ✅ 100 requests/day (sufficient with caching)

## Success Criteria

✅ **Integration Working If:**
1. `node check-api-keys.js` shows APISPORTS_API_KEY configured
2. Server console shows "✅ NFL Stats service initialized"
3. Parlay generation logs show "📊 Using NFL Stats API"
4. Parlay output includes "**📊 TEAM STATS & RECORDS:**"
5. Stats show real numbers (PPG, yards/game, W-L record)

## Next Steps After Testing

1. **Monitor API usage**: Check `/debug/nfl-stats` periodically
2. **Verify accuracy**: Compare stats with ESPN/NFL.com
3. **Test edge cases**: 
   - Games with no stats available
   - Teams with unusual names
   - Injury-heavy games
4. **Optimize caching**: Adjust TTL if needed (currently 1 hour)

## Support

If issues persist:
1. Check `NFL_STATS_INTEGRATION.md` for detailed docs
2. Review server logs for error messages
3. Test API key at https://dashboard.api-football.com/
4. Verify API-Sports service status
