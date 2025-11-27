# Phase 2: Player Stats via Box Scores

## The Problem

ESPN's `/athletes/{id}/gamelog` endpoint **doesn't exist** (404 errors).

## The Solution

Use **endpoints that actually work**:
- ✅ `/scoreboard` - Get recent games (works!)
- ✅ `/summary?event={id}` - Get box scores with player stats (works!)

## Smart Polling Strategy

Instead of fetching stats for all 12,000 players:
1. **User requests props** → Check which players have active prop odds
2. **Only fetch stats for those ~20-50 players** (massive efficiency!)
3. **Cache for 12 hours** → No repeated API calls
4. **Daily refresh** → Edge Function updates cache

---

## How It Works

### Step 1: User Requests Props
```javascript
// User selects: NFL, Player Props, Medium Risk
POST /api/suggest-picks
{
  sports: ["NFL"],
  betTypes: ["Player Props"],
  riskLevel: "Medium"
}
```

### Step 2: Identify Players from Props
```javascript
// Query odds_cache for player prop markets
SELECT DISTINCT description as player_name
FROM odds_cache
WHERE sport = 'NFL'
  AND market_type LIKE 'player_%'
  AND commence_time > NOW();

// Result: ["Lamar Jackson", "Patrick Mahomes", "Travis Kelce", ...]
```

### Step 3: Fetch Stats for Those Players Only
```javascript
// ESPNPlayerStatsBoxScore service:
// 1. Get recent games (last 7 days)
GET http://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20251126

// 2. For each game, get box score
GET http://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401671854

// 3. Extract player stats from box score
{
  "Lamar Jackson": {
    "passing_yards": 287.5,  // Average last 5 games
    "passing_tds": 2.8,
    "games_played": 5
  }
}
```

### Step 4: Enhanced AI Reasoning
```javascript
// BEFORE (No Stats):
{
  "pick": "Lamar Jackson Over 1.5 Passing TDs",
  "reasoning": "Jackson has been performing well lately..."
}

// AFTER (With Stats):
{
  "pick": "Lamar Jackson Over 1.5 Passing TDs",
  "reasoning": "Jackson averaging 2.8 passing TDs over last 5 games. 
                Hit this prop in 4 of last 5 games. Facing defense 
                allowing 2.1 TDs/game (28th)."
}
```

---

## Implementation Steps

### 1. Apply Database Schema (30 sec)
```bash
# Run in Supabase SQL Editor
database/phase2_player_stats.sql
```

### 2. Test Box Score Fetching (2 min)
```bash
node test-boxscore-stats.js
```

Expected output:
```
📊 Fetching stats for 5 players with active props...
✅ Found 15 recent NFL games
✅ Processed 15 box scores, found stats for 4 players

Lamar Jackson:
{
  "games_played": 5,
  "passing_yards": "287.5",
  "passing_tds": "2.8",
  "interceptions": "0.6"
}

📝 AI Format: Lamar Jackson: 287.5 pass yds/game, 2.8 pass TDs/game (last 5 games)
```

### 3. Wire into Prop Generation (Next)
Update `api/suggest-picks.js` to:
1. Extract player names from prop odds
2. Fetch stats for those players
3. Include in AI reasoning

### 4. Create Edge Function (30 min)
Daily job at 8am to refresh stats cache for common prop players.

---

## API Efficiency

### Old Approach (Doesn't Work)
```
❌ Fetch gamelog for 12,000 players
   = 12,000 API calls
   = ESPN returns 404
```

### New Approach (Works!)
```
✅ User requests NFL props
✅ Find 20 players with active props
✅ Fetch 7 days of scoreboards = 7 API calls
✅ Fetch 15 recent box scores = 15 API calls
✅ Extract stats for 20 players
Total: ~22 API calls for complete stats

Cache for 12 hours → No repeat calls
```

---

## ESPN Endpoints That Work

### ✅ Scoreboard (Get Recent Games)
```
GET http://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20251126

Response:
{
  "events": [
    {
      "id": "401671854",
      "name": "Ravens at Chargers",
      "status": { "type": { "state": "post" } }
    }
  ]
}
```

### ✅ Summary/Box Score (Get Player Stats)
```
GET http://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401671854

Response:
{
  "boxscore": {
    "players": [
      {
        "team": { "id": "12" },
        "statistics": [
          {
            "name": "passing",
            "labels": ["C/ATT", "YDS", "TD", "INT"],
            "athletes": [
              {
                "athlete": { "displayName": "Lamar Jackson" },
                "stats": ["18/27", "285", "3", "0"]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

### ❌ Gamelog (Doesn't Exist)
```
GET https://site.api.espn.com/apis/site/v2/sports/football/nfl/athletes/3916387/gamelog
❌ 404 Not Found
```

---

## Deployment Plan

### Phase 2A: Test & Verify (Now)
1. ✅ Run `database/phase2_player_stats.sql`
2. ✅ Run `node test-boxscore-stats.js`
3. ✅ Verify stats are cached

### Phase 2B: Integration (30 min)
1. Update `generatePlayerPropSuggestions()` in `api/suggest-picks.js`
2. Extract player names from prop odds
3. Fetch stats using `ESPNPlayerStatsBoxScore`
4. Include stats in AI prompt

### Phase 2C: Automation (30 min)
1. Create Edge Function: `refresh-player-stats`
2. Schedule daily at 8am
3. Fetches stats for top 100 prop players

---

## Testing Right Now

```bash
# 1. Apply schema
# Run in Supabase: database/phase2_player_stats.sql

# 2. Test box score fetching
node test-boxscore-stats.js

# Should output:
# ✅ Found stats for X players
# ✅ Cached in player_stats_cache
# 📝 AI-formatted reasoning

# 3. Check cache in Supabase
SELECT 
  espn_id,
  sport,
  stats->>'games_played' as games,
  stats->>'passing_yards' as pass_yds,
  updated_at
FROM player_stats_cache
ORDER BY updated_at DESC
LIMIT 10;
```

---

## Success Metrics

### Phase 2A Complete ✅
- [ ] Schema applied
- [ ] Box scores fetching successfully
- [ ] Stats cached in database
- [ ] AI-formatted output looks good

### Phase 2B Complete ✅
- [ ] Props use real stats in reasoning
- [ ] "Lamar Jackson: 287.5 pass yds/game (last 5)" 
- [ ] Win rate improves on prop picks

### Phase 2C Complete ✅
- [ ] Daily refresh scheduled
- [ ] Cache stays fresh automatically
- [ ] No manual intervention needed

---

## Next Steps

**Run this now:**
```bash
# 1. Apply schema
# Supabase SQL Editor: database/phase2_player_stats.sql

# 2. Test
node test-boxscore-stats.js

# If it works → Wire into suggest-picks.js
# If it fails → Check ESPN API structure
```

**Key Insight:** We're not fetching stats for ALL players. We only fetch for the ~20-50 players that have **active prop odds right now**. This is efficient and targeted! 🎯
