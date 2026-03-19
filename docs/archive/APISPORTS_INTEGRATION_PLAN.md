# 🏈 API-Sports Integration Plan

## Overview
Integrate API-Sports NFL data to provide **real statistics** for AI analysis instead of generic reasoning.

---

## What You Get with API-Sports NFL

### Available Endpoints:
1. **Teams** - NFL/NCAAF team rosters
2. **Standings** - Current W-L records, rankings
3. **Players** - Complete player database
4. **Player Statistics** - Season totals & per-game stats
5. **Game Statistics** - Box scores, player performance
6. **Injuries** - **CRITICAL** - Current injury reports
7. **Schedule** - Upcoming games
8. **Historical Data** - Past seasons

---

## Architecture Decision

### ✅ KEEP ESPN
- **Purpose**: Game settlement only
- **Why**: Free, reliable for final scores
- **No change**: Settlement logic stays as-is

### ✅ ADD API-Sports  
- **Purpose**: Research & analysis
- **Why**: Real stats for AI reasoning
- **Integration**: New service layer

### Result: Dual System
```
Pick Generation:
  ├─ Odds API → Game lines
  ├─ API-Sports → Player stats, injuries, team analytics
  ├─ RSS Feeds → News context
  └─ AI Analyst → Data-driven picks

Settlement:
  └─ ESPN API → Final scores (existing, keep as-is)
```

---

## Database Strategy

### Option 1: Fresh Start (RECOMMENDED)
**Pros:**
- Clean schema optimized for API-Sports
- No migration headaches
- Proper indexes and relationships
- Run `database/apisports-schema.sql`

**Cons:**
- Lose existing team_stats_season data (if any exists)
- Need to map team names between systems

### Option 2: Hybrid
**Pros:**
- Keep existing teams table
- Add new player/injury tables

**Cons:**
- More complex mapping
- Mixed data sources

**Recommendation**: Go with Option 1 - fresh schema is cleaner.

---

## Implementation Phases

### Phase 1: Setup (Week 1)
**Goal**: Get data flowing into database

1. **Subscribe to API-Sports**
   - Plan: NFL API ($20-30/month)
   - Get API key
   - Test endpoints

2. **Create Database Schema**
   ```bash
   # Run in Supabase SQL Editor
   database/apisports-schema.sql
   ```

3. **Build API-Sports Service**
   - `lib/services/apisports-client.js`
   - Fetch teams, players, injuries
   - Cache in Supabase
   - Rate limit: 100 calls/day

4. **Daily Sync Job**
   - Cron: Update injuries (critical!)
   - Cron: Update standings
   - Cron: Update player stats after games
   - Supabase Edge Function or Railway cron

**Deliverable**: Database populated with current NFL data

---

### Phase 2: Research Integration (Week 2)
**Goal**: AI uses real stats in analysis

1. **Enhance Research Agent**
   - Query injuries before picks
   - Fetch player recent performance (last 5 games)
   - Pull team stats (offensive/defensive rankings)

2. **Update Analyst Prompts**
   - Include player stats in context
   - Show injury impact
   - Cite specific numbers

3. **Example Output**
   ```
   Tyrod Taylor Over 167.5 Passing Yards
   
   STATISTICAL EDGE:
   - Taylor avg: 185.3 yards/game this season
   - Last 3 games: 201, 178, 156 yards (trending up)
   - vs Jets career: 3 games, 223 avg yards
   - Jets pass defense: 28th ranked (254.8 ypg allowed)
   - Key: Jets LB injured (tackles leader out)
   
   VALUE: Line at 167.5 is 18 yards below his average.
   Strong play given matchup and recent form.
   ```

**Deliverable**: Picks backed by real statistics

---

### Phase 3: Player Props (Week 3)
**Goal**: Enable player prop betting with confidence

1. **Player Prop Analysis**
   - Query player game-by-game stats
   - Calculate averages vs specific opponents
   - Factor in injuries (own team & opponent)

2. **Matchup Analytics**
   - WR vs CB rankings
   - RB yards vs run defense
   - QB vs pass defense

3. **Historical Patterns**
   - Home/away splits
   - Division games
   - Weather impact

**Deliverable**: High-confidence player prop picks

---

### Phase 4: Learning Enhancement (Week 4)
**Goal**: Learning system uses real stats

1. **Post-Game Analysis**
   - Fetch actual player stats after settlement
   - Compare prediction vs reality
   - Store in learning system

2. **Pattern Detection**
   - "Taylor goes over when Jets LB is injured"
   - "Avoid WR props in weather"
   - Track what works

**Deliverable**: Self-improving AI with real data validation

---

## API Quota Management

### NFL API Limits:
- **100 calls/day** on basic plan
- **10,000 calls/month** on pro plan

### Smart Usage Strategy:

**Daily Updates (Morning):**
```
1. Injuries (1 call) ← CRITICAL
2. Standings (1 call)
3. Today's games (1 call)
= 3 calls/day
```

**Game Day (Evening):**
```
1. Player stats for today's games (5-10 calls)
2. Team stats update (2 calls)
= 7-12 calls/day
```

**Total: ~15 calls/day** = well under limit

**Cache Strategy:**
- Player season stats: Update weekly
- Team stats: Update after each game
- Injuries: Update daily (critical!)
- Historical data: One-time fetch, stored forever

---

## Cost Analysis

### API-Sports:
- **NFL Basic**: $20-30/month
- **NFL + NCAAF**: $40-50/month
- **Pro Plan** (higher limits): $80/month

### Current Costs:
- The Odds API: ~$0/month (free tier)
- OpenAI: ~$20/month (current usage)
- Supabase: Free tier
- Railway: ~$5/month

### New Total:
- **With NFL API**: $45-55/month
- **ROI**: Massive - users will trust picks with real stats

---

## Migration Plan

### Existing Data:
1. **teams table** - Add apisports_id column, map teams
2. **team_stats_season** - Can deprecate or keep for historical
3. **news_articles** - Keep as-is (RSS feeds still valuable!)

### Team Name Mapping:
```javascript
// API-Sports uses full names, need mapping
const teamMapping = {
  'Atlanta Falcons': { espn: 'Falcons', apisports_id: 1 },
  'New York Jets': { espn: 'Jets', apisports_id: 20 },
  // ... etc
};
```

### No Downtime:
1. Create new tables alongside existing
2. Build new service, test in parallel
3. Switch research agent to new service
4. Keep ESPN settlement unchanged
5. Deprecate old tables when confident

---

## Success Metrics

### Before (Current):
- ❌ "Catches our eye" generic analysis
- ❌ No injury awareness
- ❌ No player performance data
- ❌ No statistical backing

### After (With API-Sports):
- ✅ "Taylor averaging 185 ypg, line is 167.5"
- ✅ "Jets LB injured, allows +40 rush yards"
- ✅ "3 games vs Jets: 223, 201, 245 yards"
- ✅ Data-driven confidence scores

### User Trust:
- Can see the stats backing each pick
- Transparent reasoning
- Verifiable claims
- Professional analysis

---

## Next Steps

### Immediate (Today):
1. ✅ Review this plan
2. ✅ Review database schema
3. ⏳ Subscribe to API-Sports NFL

### Week 1:
1. Run database schema
2. Build API-Sports client service
3. Create sync job for daily updates
4. Populate database with current season

### Week 2:
1. Integrate with research agent
2. Update analyst prompts
3. Test picks with real stats
4. Deploy and monitor

---

## Files Created

1. `database/apisports-schema.sql` - Complete database schema
2. `APISPORTS_INTEGRATION_PLAN.md` - This document

## Files to Create:

1. `lib/services/apisports-client.js` - API wrapper
2. `lib/services/apisports-sync.js` - Daily sync logic
3. `api/sync-apisports.js` - Cron endpoint
4. `scripts/populate-apisports.js` - Initial data load
5. `scripts/map-teams.js` - Team name mapping utility

---

## Questions?

### Do we need to redo everything?
**No.** Keep ESPN for settlement, RSS feeds for news. Just add API-Sports for stats.

### What about existing team_stats_season?
**Deprecate gradually.** New schema is better, but no rush to delete old data.

### How long to implement?
**2-4 weeks** for full integration, but you'll see better picks after Week 1.

### Is it worth the cost?
**Absolutely.** $30/month for professional-grade analysis vs. generic AI guessing.

---

Ready to proceed? Let me know and I'll start building the API-Sports client service!
