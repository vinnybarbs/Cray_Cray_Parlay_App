# How to Monitor AI Research & Cache Logs

## 🔍 See AI Function Calling in Action

### Railway Production Logs

**Watch live:**
```bash
# Open Railway dashboard
open https://railway.app/project/YOUR_PROJECT_ID

# Or use Railway CLI
railway logs
```

**What to look for:**

```
🔄 Function calling iteration 1...
   🔧 AI requested 12 function calls
   📞 Calling get_team_stats({"teamName":"Jacksonville Jaguars"})
📊 AI Function: getTeamStats("Jacksonville Jaguars", 3)
   ✓ Result: {"success":true,"team":"Jacksonville Jaguars","record":"7-4","stats":{"wins":7,"losses":4,"pointsPerGame":"28.3","pointsAllowedPerGame":"22.8",...
   📞 Calling get_team_stats({"teamName":"Tennessee Titans"})
📊 AI Function: getTeamStats("Tennessee Titans", 3)
   ✓ Result: {"success":true,"team":"Tennessee Titans","record":"3-8","stats":{"wins":3,"losses":8,"pointsPerGame":"22.5","pointsAllowedPerGame":"25.7",...
   📞 Calling get_player_stats({"playerName":"Sean Tucker","teamName":"Tampa Bay Buccaneers","statType":"rushing","lastNGames":5})
📊 AI Function: getPlayerStats("Sean Tucker", "Tampa Bay Buccaneers", "rushing", 5)
   ✓ Result: {"success":true,"player":"Sean Tucker","games":5,"average":{"rushYards":"32.8","rushTDs":"0.4"},...
🔄 Function calling iteration 2...
✅ AI finished after 2 iteration(s)
⚠️  Response not JSON, requesting proper format...
✅ Reformatted as JSON
```

### Cache Hit/Miss Logs

```
✅ Cache hit! Returning 20 cached suggestions (15min old)
📭 Cache miss - generating fresh suggestions...
💾 Cached 20 suggestions (expires in 1h)
♻️  Refreshing NFL medium (45min old)
```

### Research Quality Logs

**Good reasoning (with research):**
```
🎯 Analytical Summary: Analysis based on team records, PPG, and defensive stats
📊 Edge Types Found: line_value, information, situational
```

**Bad reasoning (generic):**
```
❌ "Current pricing appears favorable"
❌ "Leverage advanced modeling"
```

---

## 📊 Monitor Cache Performance

### Check Cache Status (Supabase)

```sql
-- See all cached suggestions
SELECT 
  sport,
  risk_level,
  num_suggestions,
  accessed_count,
  EXTRACT(EPOCH FROM (NOW() - generated_at))/60 as age_minutes,
  EXTRACT(EPOCH FROM (expires_at - NOW()))/60 as ttl_minutes
FROM ai_suggestions_cache
WHERE expires_at > NOW()
ORDER BY generated_at DESC;
```

### Cache Hit Rate

```sql
-- Calculate cache efficiency
SELECT 
  COUNT(*) as total_entries,
  AVG(accessed_count) as avg_accesses,
  SUM(accessed_count) as total_hits
FROM ai_suggestions_cache;
```

---

## 🎮 Test AI Research Live

### 1. Request Picks & Watch Logs

Open 2 terminals:

**Terminal 1 - Railway Logs:**
```bash
railway logs --follow
```

**Terminal 2 - Request Picks:**
```bash
curl -X POST https://craycrayparlayapp-production.up.railway.app/api/suggest-picks \
  -H "Content-Type: application/json" \
  -d '{
    "selectedSports": ["NFL"],
    "riskLevel": "Medium",
    "selectedBetTypes": ["Moneyline/Spread"]
  }' | jq '.suggestions[] | {pick: .pick, confidence: .confidence, reasoning: .reasoning}'
```

### 2. Force Cache Miss (Test Research)

```bash
# Clear cache first
curl -X POST https://your-app.up.railway.app/api/test-cache-clear

# Then request picks - will show full research
curl -X POST https://your-app.up.railway.app/api/suggest-picks ...
```

### 3. Verify Function Calls Worked

Look for in logs:
- ✅ `get_team_stats` called for BOTH teams in each game
- ✅ Actual stats returned (PPG, wins, losses, differential)
- ✅ Reasoning includes specific numbers: "Jaguars (7-4, 28.3 PPG)"
- ❌ NO generic text: "leverage advanced modeling"

---

## 🐛 Debug Issues

### AI Not Calling Functions?

Check logs for:
```
🔄 Function calling iteration 1...
   🔧 AI requested 0 function calls  ❌ BAD
   
Expected:
   🔧 AI requested 12 function calls  ✅ GOOD
```

If 0 calls, check:
- `tool_choice: 'required'` is set (iteration 1)
- Function schemas are passed to OpenAI
- OpenAI API key is valid

### Generic Reasoning?

```
❌ "Current pricing appears favorable"
❌ "Jaguars have better scoring capacity"

Expected:
✅ "Jaguars (7-4) average 28.3 PPG vs Titans (3-8) who allow 25.7 PPG"
```

If generic:
- Check AI didn't skip research
- Verify function results contain actual data
- Check prompt enforces specific stats

### Cache Not Working?

```sql
-- Check table exists
SELECT COUNT(*) FROM ai_suggestions_cache;

-- Check entries are fresh
SELECT * FROM ai_suggestions_cache WHERE expires_at > NOW();

-- Check logs show cache checks
-- Should see: "✅ Cache hit!" or "📭 Cache miss"
```

---

## 📈 Production Monitoring

### Key Metrics

**OpenAI Usage:**
- Before cache: ~100 calls/day
- After cache: ~10 calls/day (90% hit rate)

**Response Times:**
- Cache hit: <100ms
- Cache miss: ~30s

**Cost:**
- Cache hit: $0.00
- Cache miss: ~$0.50

### Alerts to Set

- ❌ Cache hit rate < 50% (cache not working)
- ❌ Generic reasoning appearing (AI skipping research)
- ❌ No function calls logged (function calling broken)
- ❌ Response time > 5s on cache hits (cache not being used)

---

## 🎯 Quick Health Check

Run this to verify everything works:

```bash
# 1. Check cache table exists
supabase db execute "SELECT COUNT(*) FROM ai_suggestions_cache;"

# 2. Request picks
curl -X POST https://your-app.up.railway.app/api/suggest-picks \
  -H "Content-Type: application/json" \
  -d '{"selectedSports": ["NFL"], "riskLevel": "Medium"}'

# 3. Check Railway logs
railway logs | grep "Function calling iteration"
railway logs | grep "Cache hit"
railway logs | grep "get_team_stats"

# 4. Verify reasoning has numbers
railway logs | grep "pointsPerGame"
```

**Expected:**
- ✅ Table exists
- ✅ API returns 200
- ✅ Logs show function calls OR cache hit
- ✅ Reasoning has specific stats

---

**Status:** Ready to monitor!
**Railway Dashboard:** https://railway.app
**Supabase Dashboard:** https://supabase.com/dashboard
