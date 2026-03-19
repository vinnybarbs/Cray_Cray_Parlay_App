# ESPN Integration Roadmap
## Strategic Implementation Plan

## The Big Picture

You need 4 interconnected systems:
1. **Game Outcomes** (for validating picks → win rate)
2. **Team Records** (for better analysis)
3. **Player Stats** (for player props)
4. **NCAAB Support** (new sport)

---

## Why ESPN API is Hard

ESPN Core API uses **numeric IDs only** (no strings):
- Teams: `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2024/teams/12`
- Players: `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/3139477`
- Games: `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/401671783`

**The Challenge:** You have team names ("Kansas City Chiefs"), but ESPN wants IDs (12).

**The Solution:** Build a mapping layer + use ESPN's Site API (easier) where possible.

---

## Recommended Implementation Order

### Phase 1: Game Outcomes (CRITICAL - Start Here)
**Priority: 🔥 HIGH - Needed for validation/learning loop**

**Why First:**
- Unblocks win rate tracking
- Relatively simple (ESPN Scoreboard API is friendly)
- High impact (proves the system works)

**What to Build:**
1. **ESPN Scoreboard Service** (`lib/services/espn-scoreboard.js`)
   - Fetch completed games by sport/date
   - Parse final scores, team names
   - Cache in `game_results` table

2. **Enhanced Outcome Checker** (update `parlay-outcome-checker.js`)
   - Query `game_results` for finished games
   - Match team names to parlay legs
   - Calculate leg outcomes (spread, ML, total)
   - Update parlay win/loss status

3. **Scheduled Job** (Supabase Edge Function or cron)
   - Runs daily at midnight + 6am (catch late games)
   - Checks all pending parlays
   - Updates outcomes

**Complexity:** Medium (team name matching is tricky)
**Time:** 2-3 days
**Impact:** Enables learning loop

---

### Phase 2: Player Stats for Props (HIGH IMPACT)
**Priority: 🔥 HIGH - Needed for better prop analysis**

**Why Second:**
- Most complex (needs player ID mapping)
- High value (props are profitable)
- Builds on Phase 1 infrastructure

**What to Build:**
1. **Player ID Mapping System**
   - ESPN player IDs → names
   - Cache in `espn_players` table
   - Update via Edge Function weekly

2. **Player Stats Service** (`lib/services/espn-player-stats.js`)
   - Fetch recent player stats (last 5 games)
   - Parse relevant stats per sport:
     - **NFL**: Passing yards, TDs, rushing, receiving
     - **NBA**: Points, rebounds, assists, 3PT
     - **MLB**: Hits, HRs, RBIs, strikeouts
   - Cache in `player_stats_cache` table

3. **Stats Integration** (update `research-agent.js`)
   - Query player stats when player props available
   - Format for AI: "Player X averaging Y over last 5"
   - Include in research context

**Complexity:** High (player ID mapping, stats parsing)
**Time:** 4-5 days
**Impact:** Better prop picks

---

### Phase 3: Team Records/Standings (ALREADY STARTED)
**Priority: 🟡 MEDIUM - You already have `ingest-standings` function**

**Why Third:**
- Already 50% done
- Lower complexity
- Nice-to-have for research

**What to Complete:**
1. **Schedule `ingest-standings`** (already built!)
   - Run daily at 6am
   - Updates `team_stats_season` table

2. **Wire into Research** (update `research-agent.js`)
   - Query team records when analyzing games
   - Include in AI context: "Team X is 10-2 (5-7 ATS)"

3. **Expand to All Sports**
   - Currently NFL-only
   - Add NBA, MLB, NHL

**Complexity:** Low (mostly done)
**Time:** 1 day
**Impact:** Modest research boost

---

### Phase 4: NCAAB Support (NEW SPORT)
**Priority: 🟢 LOW - Do last (most work, seasonal)**

**Why Last:**
- Requires all above infrastructure
- March Madness specific
- Can wait until system is proven

**What to Build:**
1. **Add NCAAB Config**
   - Odds API integration
   - ESPN scoreboard endpoint
   - Team/player mappings

2. **UI Updates**
   - Add "NCAAB" to sport selector
   - Handle college team names
   - Conference-based filtering

3. **College-Specific Logic**
   - Different betting markets
   - Conference rivalries
   - Tournament seeding

**Complexity:** Medium (lots of edge cases)
**Time:** 3-4 days
**Impact:** Expands market (seasonal)

---

## Detailed Phase 1 Implementation (Start Here)

### Step 1.1: Create Game Results Table

```sql
-- Create table to cache ESPN game results
CREATE TABLE IF NOT EXISTS game_results (
  id BIGSERIAL PRIMARY KEY,
  sport VARCHAR(50) NOT NULL,
  game_date DATE NOT NULL,
  espn_event_id VARCHAR(255),
  home_team VARCHAR(255) NOT NULL,
  away_team VARCHAR(255) NOT NULL,
  home_score INTEGER,
  away_score INTEGER,
  status VARCHAR(50), -- 'final', 'in_progress', 'scheduled'
  metadata JSONB, -- Full ESPN response for reference
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(espn_event_id)
);

CREATE INDEX idx_game_results_date ON game_results(game_date);
CREATE INDEX idx_game_results_teams ON game_results(home_team, away_team);
CREATE INDEX idx_game_results_status ON game_results(status);
```

### Step 1.2: Build ESPN Scoreboard Service

```javascript
// lib/services/espn-scoreboard.js
class ESPNScoreboardService {
  constructor(supabase) {
    this.supabase = supabase;
    this.baseUrl = 'http://site.api.espn.com/apis/site/v2/sports';
    
    this.sports = {
      NFL: 'football/nfl',
      NBA: 'basketball/nba',
      MLB: 'baseball/mlb',
      NHL: 'hockey/nhl',
      NCAAF: 'football/college-football'
    };
  }

  async fetchScoreboard(sport, date) {
    // Format: YYYYMMDD
    const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
    const sportPath = this.sports[sport];
    
    const url = `${this.baseUrl}/${sportPath}/scoreboard?dates=${dateStr}`;
    const response = await fetch(url);
    const data = await response.json();
    
    return this.parseGames(data, sport);
  }

  parseGames(data, sport) {
    const games = [];
    
    for (const event of data.events || []) {
      const competition = event.competitions[0];
      const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
      const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
      
      games.push({
        espn_event_id: event.id,
        sport,
        game_date: new Date(event.date),
        home_team: homeTeam.team.displayName,
        away_team: awayTeam.team.displayName,
        home_score: parseInt(homeTeam.score) || null,
        away_score: parseInt(awayTeam.score) || null,
        status: event.status.type.name.toLowerCase(),
        metadata: { event, competition }
      });
    }
    
    return games;
  }

  async cacheGames(games) {
    // Upsert to game_results table
    for (const game of games) {
      await this.supabase
        .from('game_results')
        .upsert(game, { onConflict: 'espn_event_id' });
    }
  }
}
```

### Step 1.3: Update Outcome Checker

```javascript
// Add to parlay-outcome-checker.js
async checkParlayOutcome(parlay) {
  const legs = parlay.metadata?.locked_picks || [];
  let allLegsResolved = true;
  let wonCount = 0;
  let lostCount = 0;

  for (const leg of legs) {
    // Query game_results
    const { data: gameResult } = await this.supabase
      .from('game_results')
      .select('*')
      .ilike('home_team', `%${leg.homeTeam}%`)
      .ilike('away_team', `%${leg.awayTeam}%`)
      .eq('status', 'final')
      .single();

    if (!gameResult) {
      allLegsResolved = false;
      continue;
    }

    // Determine outcome based on bet type
    const outcome = this.determineLegOutcome(leg, gameResult);
    
    if (outcome === 'won') wonCount++;
    if (outcome === 'lost') lostCount++;
  }

  // Update parlay if all legs resolved
  if (allLegsResolved) {
    const finalOutcome = lostCount === 0 ? 'won' : 'lost';
    await this.updateParlayOutcome(parlay.id, finalOutcome);
  }
}

determineLegOutcome(leg, gameResult) {
  const { home_score, away_score } = gameResult;
  
  switch(leg.betType) {
    case 'Moneyline':
      const winner = home_score > away_score ? gameResult.home_team : gameResult.away_team;
      return leg.pick.includes(winner) ? 'won' : 'lost';
    
    case 'Spread':
      const line = parseFloat(leg.point);
      const adjustedHomeScore = home_score + (leg.pick.includes(gameResult.home_team) ? line : -line);
      return adjustedHomeScore > away_score ? 'won' : 'lost';
    
    case 'Totals':
      const total = home_score + away_score;
      const targetTotal = parseFloat(leg.point);
      if (leg.pick.includes('Over')) {
        return total > targetTotal ? 'won' : 'lost';
      } else {
        return total < targetTotal ? 'won' : 'lost';
      }
    
    default:
      return 'pending'; // Player props need separate handling
  }
}
```

### Step 1.4: Create Edge Function to Run Daily

```typescript
// supabase/functions/check-outcomes/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';

serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // 1. Fetch yesterday's games from ESPN
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  for (const sport of ['NFL', 'NBA', 'MLB', 'NHL']) {
    const scoreboard = new ESPNScoreboardService(supabase);
    const games = await scoreboard.fetchScoreboard(sport, yesterday);
    await scoreboard.cacheGames(games);
  }

  // 2. Check all pending parlays
  const outcomeChecker = new ParlayOutcomeChecker(supabase);
  const results = await outcomeChecker.checkAllPendingParlays();

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

### Step 1.5: Schedule Daily Runs

```sql
-- Run at midnight and 6am (catch late games)
SELECT cron.schedule(
  'check-outcomes-midnight',
  '0 0 * * *',
  $$
    SELECT net.http_post(
      url := 'https://xxx.supabase.co/functions/v1/check-outcomes',
      headers := jsonb_build_object('Authorization', 'Bearer xxx')
    );
  $$
);

SELECT cron.schedule(
  'check-outcomes-morning',
  '0 6 * * *',
  $$
    SELECT net.http_post(
      url := 'https://xxx.supabase.co/functions/v1/check-outcomes',
      headers := jsonb_build_object('Authorization', 'Bearer xxx')
    );
  $$
);
```

---

## Challenges & Solutions

### Challenge 1: Team Name Matching
**Problem:** "LA Lakers" vs "Los Angeles Lakers" vs "Lakers"

**Solution:** Build fuzzy matching + team aliases table
```sql
CREATE TABLE team_aliases (
  canonical_name VARCHAR(255),
  alias VARCHAR(255),
  sport VARCHAR(50)
);

INSERT INTO team_aliases VALUES
  ('Los Angeles Lakers', 'Lakers', 'NBA'),
  ('Los Angeles Lakers', 'LA Lakers', 'NBA'),
  ('Los Angeles Lakers', 'L.A. Lakers', 'NBA');
```

### Challenge 2: Player ID Mapping
**Problem:** "LeBron James" → ESPN player ID?

**Solution:** Build player lookup during roster population
```sql
CREATE TABLE espn_players (
  espn_player_id VARCHAR(255) PRIMARY KEY,
  full_name VARCHAR(255),
  sport VARCHAR(50),
  team VARCHAR(255),
  position VARCHAR(50),
  cached_at TIMESTAMPTZ
);
```

### Challenge 3: ESPN Rate Limits
**Problem:** 100-200 requests/hour

**Solution:**
- Cache everything (game_results, player_stats, team_stats)
- Batch requests
- Only fetch what changed

---

## Success Metrics

### Phase 1 (Game Outcomes)
- ✅ 95%+ of parlays auto-resolved within 24 hours
- ✅ Win rate calculation accurate
- ✅ Zero manual intervention needed

### Phase 2 (Player Stats)
- ✅ Player stats included in 80%+ of prop picks
- ✅ AI cites recent stats in reasoning
- ✅ Props hit rate improves 5-10%

### Phase 3 (Team Records)
- ✅ Team records in 100% of research
- ✅ ATS records influence spread picks

### Phase 4 (NCAAB)
- ✅ NCAAB parlays available March-April
- ✅ Same win rate as other sports

---

## Implementation Timeline

**Week 1:** Phase 1 (Game Outcomes)
- Days 1-2: Build scoreboard service + table
- Days 3-4: Update outcome checker
- Day 5: Edge Function + scheduling
- Days 6-7: Testing + refinement

**Week 2:** Phase 2 (Player Stats)
- Days 1-2: Player ID mapping system
- Days 3-4: Stats service + caching
- Day 5: Research integration
- Days 6-7: Testing + tuning

**Week 3:** Phase 3 (Team Records)
- Day 1: Schedule ingest-standings
- Day 2: Wire into research
- Days 3-5: Expand to all sports
- Days 6-7: Testing

**Week 4:** Phase 4 (NCAAB) - Optional
- Days 1-3: NCAAB configuration
- Days 4-5: UI updates
- Days 6-7: Testing

---

## Next Action

**Start with Phase 1 - Game Outcomes**

Would you like me to:
1. Create the `game_results` table schema
2. Build the `ESPNScoreboardService`
3. Update the `ParlayOutcomeChecker`
4. Create the Edge Function

Or do you want to discuss the approach first?

---

## Key Files to Create/Update

### New Files:
- `lib/services/espn-scoreboard.js` - Fetch game results
- `supabase/functions/check-outcomes/index.ts` - Daily outcome checker
- `database/schema/game_results.sql` - Game results table
- `database/schema/team_aliases.sql` - Team name mapping

### Files to Update:
- `lib/services/parlay-outcome-checker.js` - Enhanced outcome logic
- `lib/services/espn-api-service.js` - Add player stats methods
- `lib/agents/research-agent.js` - Use player/team stats

Ready to start Phase 1?
