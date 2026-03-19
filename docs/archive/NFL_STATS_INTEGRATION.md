# NFL Stats Integration - API-Sports

## Overview

The app now uses **real NFL statistics** from API-Sports instead of relying on Google searches. This provides accurate, real-time data for:

- ✅ Team records (W-L)
- ✅ Team statistics (offense, defense, yards/game)
- ✅ Points scored/allowed per game
- ✅ Passing/rushing yards per game
- ✅ Injury reports with player status
- ✅ Current season standings

## What Changed

### Before (Google Search via Serper):
```
User Request → Odds API → Serper Google Search → AI Analysis
                           ↓
                    "Team X is 8-2..." (from news articles)
```

### After (Real Stats via API-Sports):
```
User Request → Odds API → API-Sports NFL Stats → AI Analysis
                           ↓
                    Real data: Team X (8-2), 28.5 PPG, 245 pass yds/game
```

## Data Flow

```
Phase 1: Odds Agent
  ↓ Fetches NFL games with odds
  
Phase 2: Research Agent
  ↓ Detects NFL game
  ↓ Calls NFL Stats Service
  ↓ Gets:
     - Team records from standings
     - Team stats (offense/defense)
     - Injury reports
  ↓ Formats for AI
  
Phase 3: AI Analyst
  ↓ Receives REAL stats instead of Google snippets
  ↓ Generates data-driven parlay
```

## Files Modified

### New Files:
- `lib/services/nfl-stats.js` - NFL Stats service (team stats, standings, injuries)

### Modified Files:
- `lib/agents/research-agent.js` - Integrated NFL stats, falls back to Serper for non-NFL
- `server.js` - Added `/debug/nfl-stats` endpoint
- `check-api-keys.js` - Updated to check APISPORTS_API_KEY

## API Endpoints Used

From https://api-sports.io/documentation/nfl/v1:

| Endpoint | Purpose | Data Returned |
|----------|---------|---------------|
| `/teams` | Find team IDs | Team names, IDs, logos |
| `/standings` | Team records | W-L records, division standings |
| `/teams/statistics` | Team stats | PPG, yards/game, offense/defense stats |
| `/injuries` | Injury reports | Player name, status, team |

## Configuration

### Required API Key:
```bash
# In .env or .env.local
APISPORTS_API_KEY=your_key_here
```

### Get Your Key:
1. Sign up at https://dashboard.api-football.com/register
2. Free tier: 100 requests/day
3. Covers NFL, NCAAF, NBA

## Testing

### 1. Check API Key Status:
```bash
node check-api-keys.js
```

Expected output:
```
✅ Configured APISPORTS_API_KEY (742fae24...)
   Player Verification: ✅ Enabled
```

### 2. Test NFL Stats Service:
```bash
# Start server
npm run dev

# In another terminal, test the endpoint
curl http://localhost:5001/debug/nfl-stats
```

Expected response:
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
  }
}
```

### 3. Generate NFL Parlay:
1. Start server: `npm run dev`
2. Generate a parlay for NFL
3. Check console logs for:
   ```
   📊 Using NFL Stats API for real data
   ✅ NFL stats retrieved successfully
   ```
4. Check parlay output for real stats in reasoning

## Example Output

### Before (Google Search):
```
Context: Patriots injury report shows... recent performance trending...
```

### After (Real Stats):
```
**📊 TEAM STATS & RECORDS:**

**New England Patriots** (7-3):
  • Points/Game: 24.8 (Allowed: 19.2)
  • Total Yards/Game: 352.4
  • Passing Yards/Game: 245.6
  • Rushing Yards/Game: 106.8
  • Injuries: Mac Jones (Questionable), Damien Harris (Out)

**Buffalo Bills** (8-2):
  • Points/Game: 28.5 (Allowed: 17.8)
  • Total Yards/Game: 389.2
  • Passing Yards/Game: 278.4
  • Rushing Yards/Game: 110.8
  • Injuries: None
```

## Caching

- **Cache Duration**: 1 hour (stats change during games)
- **Cache Keys**: Endpoint + parameters
- **Benefits**: 
  - Reduces API calls
  - Faster response times
  - Stays within free tier limits (100 req/day)

## Fallback Behavior

The system gracefully handles errors:

1. **NFL game + API key configured**: Use real stats ✅
2. **NFL game + API key missing**: Fall back to Serper search
3. **NFL game + API error**: Fall back to Serper search
4. **Non-NFL game**: Use Serper search (as before)

## Console Output

When generating NFL parlays, you'll see:

```
🔍 PHASE 2: ENHANCED RESEARCH
✅ NFL Stats service initialized
🔍 SMART TIERED RESEARCH: 5 games, 3 legs needed, Medium risk
📊 Researching top 9 games with moderate depth
  📡 Researching batch 1/1: 5 games
  🔍 Researching: Patriots @ Bills (moderate depth)
    📊 Using NFL Stats API for real data
    📊 Fetching stats for Patriots @ Bills
    ✅ NFL stats retrieved successfully
✅ Research Phase Complete: 5/5 games researched
```

## API Rate Limits

**Free Tier (100 requests/day):**
- Each game analysis = ~4 API calls (teams, standings, stats, injuries)
- Can analyze ~25 games per day
- Caching extends this significantly

**Optimization:**
- Standings cached for 1 hour (shared across all games)
- Injuries cached for 1 hour (shared across all games)
- Team stats cached per team
- Typical parlay generation: 3-5 games = 12-20 API calls (first time)
- Subsequent parlays: 0-2 API calls (cache hits)

## Troubleshooting

### Issue: "NFL Stats service not available"
**Solution**: Check that `lib/services/nfl-stats.js` exists and has no syntax errors.

### Issue: "API-Sports key not configured"
**Solution**: 
1. Add `APISPORTS_API_KEY` to `.env.local`
2. Restart server
3. Run `node check-api-keys.js` to verify

### Issue: "Failed to fetch team stats"
**Possible causes**:
1. API rate limit exceeded (100/day)
2. Invalid API key
3. Network error

**Check**:
```bash
curl http://localhost:5001/debug/nfl-stats
```

### Issue: Still seeing Google search results
**Solution**: 
1. Verify it's an NFL game (not NBA, MLB, etc.)
2. Check console for "Using NFL Stats API" message
3. If seeing "falling back to Serper", check API key and rate limits

## Benefits

### For Users:
- ✅ **Accurate data**: Real stats, not scraped articles
- ✅ **Up-to-date**: Current season records and stats
- ✅ **Comprehensive**: Team stats + injuries in one place
- ✅ **Reliable**: No dependency on Google search quality

### For AI Analysis:
- ✅ **Structured data**: Consistent format, easy to parse
- ✅ **Complete stats**: All relevant metrics available
- ✅ **Factual**: No hallucinations from vague articles
- ✅ **Comparable**: Same stats for both teams

## Future Enhancements

Potential additions using API-Sports:

1. **Player Stats**: Individual player performance data
2. **Head-to-Head History**: Past matchup results
3. **Weather Data**: Game conditions
4. **Betting Trends**: Line movement, public betting %
5. **NBA/NCAAF Stats**: Extend to other sports

## Support

- API-Sports Docs: https://api-sports.io/documentation/nfl/v1
- Dashboard: https://dashboard.api-football.com/
- Support: support@api-sports.io
