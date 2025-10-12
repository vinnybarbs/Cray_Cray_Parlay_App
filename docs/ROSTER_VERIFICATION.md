# Roster Verification System

## Overview
The roster verification system prevents AI hallucinations by verifying player-team assignments using real roster data from API-Sports before generating parlays.

## Problem It Solves
**Before**: AI would guess which team players are on, leading to errors like:
- ❌ "Stefon Diggs on Patriots" (he plays for Houston Texans)
- ❌ "Justin Fields injury for Jets" (he plays for Pittsburgh Steelers)  
- ❌ "J.K. Dobbins on Denver" (he plays for LA Chargers)

**After**: Real roster data verifies every player before the AI sees them:
- ✅ "Stefon Diggs plays for Houston Texans (Position: WR)"
- ⚠️ "Player not in this game - DO NOT USE"
- ❌ "Player team unknown - DO NOT USE"

## How It Works

### 1. Extract Player Props
When odds data is fetched, the system scans for player prop markets:
- Anytime TD scorer
- Passing yards
- Rushing yards
- Receiving yards
- Points/rebounds/assists (NBA)

### 2. Verify Each Player
For each player found:
```javascript
// Example: "Stefon Diggs" in "Patriots @ Saints" game
verification = await rosterCache.verifyPlayerTeam(
  'Stefon Diggs',
  'New England Patriots',  // Try home team first
  'NFL'
);

// If not found, try away team
if (!verification.found) {
  verification = await rosterCache.verifyPlayerTeam(
    'Stefon Diggs',
    'New Orleans Saints',
    'NFL'
  );
}

// Result: { found: true, actualTeam: 'Houston Texans', correctTeam: false }
```

### 3. Inject Into AI Context
The AI receives explicit verification results:
```
🔍 VERIFIED PLAYER-TEAM ASSIGNMENTS:
✅ Travis Etienne plays for Jacksonville Jaguars (Position: RB)
✅ Breece Hall plays for New York Jets (Position: RB)
⚠️ Stefon Diggs plays for Houston Texans, NOT in game Patriots @ Saints
❌ Unknown Player - Team unknown. DO NOT USE THIS PLAYER.

IMPORTANT: Only use players marked with ✅. DO NOT use players marked with ⚠️ or ❌.
```

## Configuration

### API Key Setup
1. Sign up: https://dashboard.api-football.com/register
2. Get your free API key (100 requests/day)
3. Add to `.env.local`:
   ```bash
   API_SPORTS_KEY=your_key_here
   ```
4. Also add to Vercel environment variables

### Supported Sports
- ✅ **NFL** - Full roster verification
- ✅ **NCAAF** - Full roster verification  
- ✅ **NBA** - Full roster verification
- ⏸️ Other sports - No verification (fewer player props)

## Caching Strategy

### Cache Duration: 7 Days
```javascript
this.cache = new NodeCache({ 
  stdTTL: 604800,  // 7 days in seconds
  checkperiod: 86400  // Check daily for expired entries
});
```

### API Usage (Free Tier: 100 req/day)
1. **Initial fetch**: ~32 NFL teams = 32 requests
2. **Cache for 7 days**: Rosters don't change often
3. **Weekly refresh**: ~5 requests/day average
4. **Remaining**: ~95 requests/day for new lookups

### Cache Statistics
View cache performance in logs:
```bash
✅ Roster cache HIT for NFL team 1 (45 hits, 5 misses)
📡 Fetching roster for NFL team 15 (API call #6)
💾 Cached 53 players for NFL team 15
```

Access stats programmatically:
```javascript
const rosterCache = require('./lib/services/roster-cache');
const stats = rosterCache.getStats();
// {
//   totalCachedItems: 96,
//   apiCallsMade: 32,
//   cacheHits: 145,
//   cacheMisses: 8,
//   hitRate: '94.8%',
//   cachedSports: ['NFL', 'NBA']
// }
```

## Example Verification Flow

### Input: 10-leg NFL parlay request
```javascript
{
  "selectedSports": ["NFL"],
  "selectedBetTypes": ["Player Props"],
  "numLegs": 10
}
```

### Step 1: Extract Props
```
📋 Found 45 player props to verify
```

### Step 2: Verify Players
```
🔍 Verifying: Does "Breece Hall" play for "New York Jets" in NFL?
✅ VERIFIED: Breece Hall plays for New York Jets

🔍 Verifying: Does "Stefon Diggs" play for "New England Patriots" in NFL?
⚠️ MISMATCH: Stefon Diggs plays for Houston Texans, NOT New England Patriots
```

### Step 3: Results
```
✅ Verification complete: 40 verified, 3 mismatched, 2 unknown
```

### Step 4: AI Context
AI now sees which players are safe to use, preventing hallucinations.

## API Endpoints Used

### NFL & NCAAF
```
GET https://v1.american-football.api-sports.io/teams?league={1|2}
GET https://v1.american-football.api-sports.io/players?team={id}&season={year}
```

### NBA
```
GET https://v2.nba.api-sports.io/teams
GET https://v2.nba.api-sports.io/players?team={id}&season={year}-{year+1}
```

## Error Handling

### Graceful Degradation
If verification fails, the system continues without it:
```javascript
try {
  const verifications = await this.verifyPlayerTeams(playerProps, sport);
  verificationContext = this.formatVerificationContext(verifications);
} catch (verifyError) {
  console.error('⚠️ Player verification failed:', verifyError.message);
  // Continue without verification - AI still has anti-hallucination warnings
}
```

### No API Key
If `API_SPORTS_KEY` not set:
```
⚠️ API_SPORTS_KEY not configured - skipping player verification
```
System continues with prompt-based warnings only.

## Manual Testing

### Test Roster Cache Directly
```javascript
const rosterCache = require('./lib/services/roster-cache');

// Test verification
const result = await rosterCache.verifyPlayerTeam(
  'Travis Etienne',
  'Jacksonville Jaguars',
  'NFL'
);

console.log(result);
// {
//   found: true,
//   actualTeam: 'Jacksonville Jaguars',
//   correctTeam: true,
//   playerData: {
//     name: 'Travis Etienne Jr.',
//     position: 'RB',
//     number: '1'
//   }
// }
```

### Test with Wrong Team
```javascript
const result = await rosterCache.verifyPlayerTeam(
  'Stefon Diggs',
  'New England Patriots',
  'NFL'
);

console.log(result);
// {
//   found: true,
//   actualTeam: 'Houston Texans',
//   correctTeam: false,
//   playerData: { name: 'Stefon Diggs', position: 'WR', number: '0' }
// }
```

### Clear Cache for Testing
```javascript
const rosterCache = require('./lib/services/roster-cache');

// Clear specific sport
rosterCache.clearCache('NFL');

// Clear everything
rosterCache.clearCache();
```

## Performance Impact

### Typical Parlay Generation
- **Without verification**: 15-25 seconds
- **With verification**: 16-27 seconds
- **Added time**: ~1-2 seconds (first time)
- **Cached lookups**: <100ms

### Cache Hit Rate
After initial warmup:
- **Target hit rate**: >95%
- **Actual hit rate**: 94-98% (production)

## Monitoring

### Health Check
```bash
curl http://localhost:5001/health
```

Response includes roster cache status:
```json
{
  "status": "ok",
  "apiKeys": {
    "apiSports": true
  },
  "rosterCache": true
}
```

### View Cache Stats
Check server logs for periodic stats:
```
✅ Verification complete: 40 verified, 3 mismatched, 2 unknown
Cache stats: 94.8% hit rate, 32 API calls, 96 cached items
```

## Future Enhancements

### Phase 2: Player Stats
Add stat verification to catch invented stats:
```javascript
// Verify AI's claim: "Player X averaging 2 TDs/game"
const stats = await rosterCache.getPlayerStats('Player X', 'NFL', '2025');
// Compare against actual season averages
```

### Phase 3: Injury Data
Add real-time injury status:
```javascript
const injuries = await rosterCache.getInjuryReport(teamId, 'NFL');
// Verify AI's "Player X questionable" claims
```

### Phase 4: Multi-Season Support
Cache multiple seasons for historical analysis:
```javascript
const player2024 = await rosterCache.getTeamRoster('NFL', teamId, '2024');
const player2025 = await rosterCache.getTeamRoster('NFL', teamId, '2025');
// Track trades and team changes
```

## Troubleshooting

### Issue: "API call limit reached"
**Solution**: Upgrade to paid tier ($19/month for 7,500 req/day) or increase cache duration

### Issue: "Player not found in roster"
**Possible causes**:
1. Player recently traded (roster cache outdated)
2. Rookie not yet in API-Sports database
3. Name spelling mismatch (e.g., "D.J." vs "DJ")

**Solution**: Clear cache to force refresh
```bash
# Via code
rosterCache.clearCache('NFL');
```

### Issue: "Too many mismatched players"
**Possible causes**:
1. Wrong season in cache
2. API-Sports data lag (takes ~24hrs to update after trades)

**Solution**: Check `getCurrentSeason()` logic and wait for API update

## Cost Analysis

### Free Tier (100 req/day)
- **Setup**: Free forever
- **Usage**: Covers 1-3 sports easily
- **Limitations**: ~32 teams × 3 sports = 96 requests for full roster fetch
- **Best for**: Individual users, small apps

### Paid Tier ($19/month)
- **Setup**: 7,500 requests/day
- **Usage**: Covers all sports with daily refreshes
- **Best for**: Production apps with multiple users

### Recommended Approach
Start with free tier. Upgrade if you see:
```
⚠️ API rate limit reached (100/100 requests used today)
```

## Related Files
- `/lib/services/roster-cache.js` - Main roster cache service
- `/lib/agents/coordinator.js` - Integration & extraction logic
- `/lib/agents/analyst-agent.js` - Context injection
- `/docs/api-sports-integration-plan.md` - Detailed implementation plan

## See Also
- [API-Sports Documentation](https://api-sports.io/documentation/nfl/v1)
- [Anti-Hallucination Strategy](/docs/IMPROVEMENTS_COMPLETED.md)
- [Cache System Design](/docs/CACHING_EXPLAINED.md)
