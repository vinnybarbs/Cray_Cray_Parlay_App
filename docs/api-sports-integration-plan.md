# API-Sports Integration Plan
## Player Roster Verification System

**Status**: Planned (Not Yet Implemented)  
**Purpose**: Prevent AI hallucinations by verifying player-team assignments with real roster data  
**Cost**: FREE (100 requests/day on free tier)

---

## Why We Need This

### Current Problem:
The AI is hallucinating player-team assignments:
- ❌ "Stefon Diggs on Patriots" (he's on Texans)
- ❌ "Justin Fields injury for Jets" (he's on Steelers)
- ❌ "J.K. Dobbins on Denver" (he's on Chargers)

### Root Cause:
- Prop markets from The Odds API show player names but NOT their teams
- AI guesses which team players are on based on game matchup
- No verification system to catch these errors

---

## Solution: API-Sports Integration

### API Details:
- **Provider**: API-Sports (https://api-sports.io)
- **Free Tier**: 100 requests/day
- **Paid Tier**: $19/month for 7,500 requests/day
- **Documentation**: 
  - NFL: https://api-sports.io/documentation/nfl/v1
  - NBA: https://api-sports.io/documentation/nba/v2
  - NCAAF: https://api-sports.io/documentation/american-football/v1

### What We'll Get:
```json
{
  "team": {
    "id": 1,
    "name": "Houston Texans",
    "logo": "https://..."
  },
  "players": [
    {
      "id": 123,
      "name": "Stefon Diggs",
      "position": "WR",
      "number": "1"
    }
  ]
}
```

---

## Implementation Plan

### Step 1: Get API Key
1. Sign up at https://dashboard.api-football.com/register
2. Get free API key (100 requests/day)
3. Add to `.env`:
   ```bash
   API_SPORTS_KEY=your_key_here
   ```

### Step 2: Create Roster Cache Service
**File**: `/lib/services/roster-cache.js`

```javascript
const NodeCache = require('node-cache');
const axios = require('axios');

class RosterCache {
  constructor() {
    // Cache rosters for 7 days (604800 seconds)
    this.cache = new NodeCache({ stdTTL: 604800 });
    this.apiKey = process.env.API_SPORTS_KEY;
  }

  async getTeamRoster(sport, teamId) {
    const cacheKey = `${sport}_team_${teamId}`;
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.log(`✅ Roster cache HIT for ${sport} team ${teamId}`);
      return cached;
    }

    // Fetch from API-Sports
    console.log(`📡 Fetching roster for ${sport} team ${teamId}`);
    const roster = await this.fetchRosterFromAPI(sport, teamId);
    
    // Cache for 7 days
    this.cache.set(cacheKey, roster);
    return roster;
  }

  async fetchRosterFromAPI(sport, teamId) {
    const endpoints = {
      'NFL': `https://v1.american-football.api-sports.io/players?team=${teamId}&season=2025`,
      'NBA': `https://v2.nba.api-sports.io/players?team=${teamId}&season=2024-2025`,
      'NCAAF': `https://v1.american-football.api-sports.io/players?team=${teamId}&season=2025`
    };

    const response = await axios.get(endpoints[sport], {
      headers: {
        'x-rapidapi-key': this.apiKey,
        'x-rapidapi-host': sport === 'NBA' ? 'v2.nba.api-sports.io' : 'v1.american-football.api-sports.io'
      }
    });

    return response.data.response;
  }

  async verifyPlayerTeam(playerName, teamName, sport) {
    // Try to find player in any cached roster
    const allKeys = this.cache.keys();
    const sportKeys = allKeys.filter(k => k.startsWith(sport));

    for (const key of sportKeys) {
      const roster = this.cache.get(key);
      const player = roster.find(p => 
        p.name.toLowerCase().includes(playerName.toLowerCase())
      );
      
      if (player) {
        return {
          found: true,
          actualTeam: player.team.name,
          correctTeam: player.team.name.toLowerCase().includes(teamName.toLowerCase())
        };
      }
    }

    return { found: false };
  }
}

module.exports = new RosterCache();
```

### Step 3: Add Player Verification to Research Agent
**File**: `/lib/agents/research-agent.js`

Add this method:
```javascript
async verifyPlayerTeams(players, sport) {
  const rosterCache = require('../services/roster-cache');
  const verifications = [];

  for (const player of players) {
    const verification = await rosterCache.verifyPlayerTeam(
      player.name,
      player.expectedTeam,
      sport
    );
    
    if (verification.found && !verification.correctTeam) {
      console.warn(`⚠️ TEAM MISMATCH: ${player.name} - Expected: ${player.expectedTeam}, Actual: ${verification.actualTeam}`);
    }

    verifications.push({
      player: player.name,
      ...verification
    });
  }

  return verifications;
}
```

### Step 4: Integrate into Coordinator
**File**: `/lib/agents/coordinator.js`

In the `generateParlay` method, after getting odds but before AI analysis:

```javascript
// Extract player props from odds data
const playerProps = this.extractPlayerProps(oddsData);

if (playerProps.length > 0) {
  console.log(`🔍 Verifying ${playerProps.length} player-team assignments...`);
  
  // Verify player teams
  const verifications = await researchAgent.verifyPlayerTeams(playerProps, sport);
  
  // Add verification results to context
  const verifiedContext = verifications.map(v => {
    if (v.found && v.correctTeam) {
      return `✅ ${v.player} plays for ${v.actualTeam}`;
    } else if (v.found && !v.correctTeam) {
      return `⚠️ ${v.player} plays for ${v.actualTeam} (NOT ${v.expectedTeam})`;
    } else {
      return `❓ ${v.player} team unknown - DO NOT USE`;
    }
  }).join('\n');

  // Inject into AI prompt
  oddsContext += `\n\n**VERIFIED PLAYER TEAMS:**\n${verifiedContext}\n`;
}
```

### Step 5: Helper Method to Extract Player Props
**File**: `/lib/agents/coordinator.js`

```javascript
extractPlayerProps(oddsData) {
  const playerProps = [];
  
  for (const game of oddsData) {
    const awayTeam = game.away_team;
    const homeTeam = game.home_team;
    
    // Look for player prop markets
    const propMarkets = game.bookmakers?.[0]?.markets?.filter(m => 
      m.key.includes('player') || 
      m.key.includes('anytime_td') ||
      m.key.includes('passing') ||
      m.key.includes('rushing') ||
      m.key.includes('receiving')
    ) || [];

    for (const market of propMarkets) {
      for (const outcome of market.outcomes || []) {
        // Extract player name from outcome
        const playerName = outcome.description || outcome.name;
        
        playerProps.push({
          name: playerName,
          market: market.key,
          game: `${awayTeam} @ ${homeTeam}`,
          expectedTeam: null // We'll try to match later
        });
      }
    }
  }
  
  return playerProps;
}
```

---

## Usage & API Call Budget

### Free Tier (100 requests/day):
- **Initial setup**: Fetch rosters for ~32 NFL teams = 32 requests
- **Cache duration**: 7 days
- **Weekly refresh**: ~5 requests/day average
- **Leaves**: ~95 requests/day for new teams/sports

### Cache Strategy:
```javascript
// Cache for 7 days
this.cache = new NodeCache({ 
  stdTTL: 604800,  // 7 days
  checkperiod: 86400  // Check for expired entries daily
});
```

### When to Upgrade to Paid ($19/month):
- Supporting multiple sports (NFL + NBA + NCAAF)
- Daily roster updates needed
- User base grows beyond free tier limits

---

## Testing Plan

### Test Cases:
1. ✅ Correct player-team assignment
   - Input: "Stefon Diggs" for Texans game
   - Expected: Verified, allow use

2. ❌ Incorrect player-team assignment
   - Input: "Stefon Diggs" for Patriots game
   - Expected: Warning, reject pick

3. ❓ Unknown player
   - Input: "Unknown Player 123"
   - Expected: Not found, skip player

### Manual Test:
```javascript
const rosterCache = require('./lib/services/roster-cache');

// Test verification
const result = await rosterCache.verifyPlayerTeam(
  'Stefon Diggs',
  'Houston Texans',
  'NFL'
);

console.log(result);
// Expected: { found: true, actualTeam: 'Houston Texans', correctTeam: true }
```

---

## Dependencies to Install

```bash
npm install node-cache axios
```

Already installed, no action needed.

---

## Environment Variables to Add

```bash
# .env
API_SPORTS_KEY=your_api_key_here
```

```javascript
// env.example - Add this line
API_SPORTS_KEY=your_api_sports_key_from_dashboard
```

---

## Rollback Plan

If API-Sports integration causes issues:

1. Comment out verification calls in `coordinator.js`
2. AI will still have strengthened anti-hallucination warnings
3. No data loss or breaking changes

---

## Future Enhancements

### Phase 2: Add Stats Verification
Once rosters work well, add player stats:
```javascript
async getPlayerStats(playerName, sport, season) {
  // Fetch actual stats from API-Sports
  // Compare against AI's claims
  // Flag invented statistics
}
```

### Phase 3: Injury Data
```javascript
async getInjuryReport(teamId, sport) {
  // GET /injuries endpoint
  // Real-time injury status
  // Prevent "on injury report" hallucinations
}
```

---

## Implementation Checklist

When ready to implement:

- [ ] Sign up for API-Sports account
- [ ] Get API key (100 req/day free)
- [ ] Add `API_SPORTS_KEY` to `.env`
- [ ] Create `/lib/services/roster-cache.js`
- [ ] Add verification method to research-agent.js
- [ ] Add `extractPlayerProps()` to coordinator.js
- [ ] Integrate verification into parlay generation
- [ ] Test with known player-team pairs
- [ ] Monitor cache hit rates in logs
- [ ] Deploy and test on production

---

## Expected Impact

### Before:
- AI guesses player teams → hallucinations
- No way to verify player-team accuracy
- Users get incorrect prop picks

### After:
- AI gets verified roster data
- Mismatched players are rejected
- Users get accurate player-team assignments
- 90%+ reduction in player hallucinations

---

## Questions to Answer Later

1. Should we pre-fetch all NFL rosters on server start?
2. How to handle mid-season trades? (refresh cache more often?)
3. Should we show "verified by API-Sports" badge on accurate picks?
4. Log all verification failures for analysis?

---

**Created**: October 11, 2025  
**Status**: Ready to implement when needed  
**Estimated Implementation Time**: 2-3 hours
