# Critical Fixes Applied - October 9, 2025

## Issues Fixed

### 1. ✅ Invalid Market Keys
**Problem:** TD Props used non-existent API market keys (`player_tds_over`, `player_rush_tds`, `player_reception_tds`)

**Solution:** Updated MARKET_MAPPING with valid keys from official API docs:
```javascript
'TD Props': [
  'player_pass_tds',        // Pass TDs (Over/Under) ✓
  'player_rush_tds',        // Rush TDs (Over/Under) ✓
  'player_reception_tds',   // Reception TDs (Over/Under) ✓
  'player_anytime_td',      // Anytime TD Scorer (Yes/No) ✓
  'player_1st_td',          // 1st TD Scorer (Yes/No) ✓
  'player_last_td'          // Last TD Scorer (Yes/No) ✓
]
```

### 2. ✅ Cache Not Including Date Parameters
**Problem:** Cache key was `${slug}-${bookmaker}-${markets}` without dates, returning stale data with started games

**Solution:** Updated getCacheKey to include date range:
```javascript
getCacheKey(slug, bookmaker, markets, commenceTimeFrom, commenceTimeTo) {
  const marketKey = Array.isArray(markets) ? markets.sort().join(',') : markets;
  const dateKey = commenceTimeFrom && commenceTimeTo 
    ? `-${commenceTimeFrom}-${commenceTimeTo}` 
    : '';
  return `${slug}-${bookmaker}-${marketKey}${dateKey}`;
}
```

### 3. ✅ Wrong Timezone (Showing 10/10 for 10/9 US Games)
**Problem:** Dates displayed in UTC/server timezone instead of US Mountain Time

**Solution:** Added Mountain Time formatting functions:
```javascript
function formatDateMT(iso) {
  return d.toLocaleDateString('en-US', { 
    month: 'numeric', 
    day: 'numeric', 
    year: 'numeric',
    timeZone: 'America/Denver'  // Mountain Time
  });
}
```

### 4. ✅ Smart Expansion Using Wrong Keys
**Problem:** Auto-expansion was adding `'player_props'` and `'team_props'` which are UI labels, not API keys

**Solution:** Created internal keys `'_player_props'` and `'_team_props'` for expansion:
```javascript
// User-selectable
'Player Props': ['player_pass_yds', 'player_rush_yds', ...],
// Internal for expansion (not user-selectable)
'_player_props': ['player_pass_yds', 'player_rush_yds', ...],
'_team_props': ['team_totals'],
```

### 5. ✅ Better Logging
**Problem:** Hard to debug what's happening

**Solution:** Added detailed logging:
- Shows user-selected bet types
- Maps them to API markets
- Warns if bet type not found in MARKET_MAPPING
- All times shown in Mountain Time

## Files Modified

1. **api/agents/odds-agent.js**
   - Updated MARKET_MAPPING with valid API keys
   - Fixed getCacheKey to include date parameters
   - Updated fetchRegularMarkets and fetchPropMarkets to pass dates to cache
   - Changed smart expansion to use `_player_props` and `_team_props`
   - Added Mountain Time formatting to all console logs
   - Added warning when unknown bet type encountered

2. **api/generate-parlay.js**
   - Updated MARKET_MAPPING (same as odds-agent)
   - Added `formatDateMT()` and `formatDateTimeMT()` helper functions
   - Updated all date displays to use Mountain Time

## API Reference Used
- Official Docs: https://the-odds-api.com/liveapi/guides/v4/
- Betting Markets: https://the-odds-api.com/sports-odds-data/betting-markets.html
- Swagger API: https://app.swaggerhub.com/apis-docs/the-odds-api/odds-api/4

## Valid Market Keys (NFL/Football)

### Featured Markets:
- `h2h` - Moneyline
- `spreads` - Point Spread
- `totals` - Over/Under
- `team_totals` - Team Totals

### Player Props:
- `player_pass_yds`, `player_pass_tds`, `player_pass_completions`, `player_pass_attempts`
- `player_rush_yds`, `player_rush_tds`, `player_rush_attempts`
- `player_receptions`, `player_reception_yds`, `player_reception_tds`
- `player_anytime_td`, `player_1st_td`, `player_last_td`

### What to Test:
1. Select 4-day range → Should show Sunday 10/12 games, NOT Thursday 10/9 started game
2. Select only "TD Props" → Should ONLY get TD-related markets
3. Check dates in results → Should show 10/9 for Oct 9 games (not 10/10)
4. Check console logs → Should show what markets are being requested
5. Try with different sports and bet types → Should only get selected markets

## Next Steps if Issues Persist:
1. Clear browser cache (old responses may be cached)
2. Check server logs for actual API URLs being constructed
3. Verify API key has access to requested markets
4. Check if bookmaker supports requested markets for that sport
