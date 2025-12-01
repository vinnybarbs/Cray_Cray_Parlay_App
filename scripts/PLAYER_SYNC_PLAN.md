# Player Data Sync Problem & Solution

## Current Problem

Your app has **two disconnected player data sources**:

1. **`players` table**: Has player records with `id` (UUID), `name`, `position`
   - Source: Currently from ESPN or manual imports
   - Has ~hundreds of records
   
2. **`player_game_stats` table**: Has game-by-game stats with `player_id` (UUID foreign key)
   - Source: Likely from API-Sports historical data
   - The `player_id` values **don't match** the `players` table
   - Result: AI function `getPlayerStats()` finds the player by name, gets their ID, but finds zero stats

## Why Tyrone Tracy Jr. Reasoning Failed

```
"Detailed recent stat splits for Tyrone Tracy Jr. are not available in the cache"
```

1. AI calls `get_player_stats("Tyrone Tracy Jr", "New York Giants", "receiving")`
2. Function finds Tracy in `players` table → gets his UUID
3. Function queries `player_game_stats` WHERE `player_id` = that UUID
4. **Returns 0 records** because `player_game_stats` uses different player IDs
5. AI hedges: "data not available"

## Solution: 3-Step Canonical Player Sync

### Step 1: Add `api_sports_id` column to `players` table

```sql
ALTER TABLE players ADD COLUMN IF NOT EXISTS api_sports_id INTEGER UNIQUE;
CREATE INDEX IF NOT EXISTS idx_players_api_sports_id ON players(api_sports_id);
```

This becomes your **canonical player identifier** across all data sources.

### Step 2: Sync NFL rosters from API-Sports

Use API-Sports `/players` endpoint with team ID to populate `players`:

```javascript
// For each NFL team:
fetch(`https://v1.american-football.api-sports.io/players?team=${teamId}&season=2024`)

// Upsert each player:
INSERT INTO players (name, api_sports_id, position, team_id, league)
VALUES ('Tyrone Tracy Jr.', 123456, 'RB', team_uuid, 'nfl')
ON CONFLICT (api_sports_id) 
DO UPDATE SET name = EXCLUDED.name, position = EXCLUDED.position, updated_at = NOW();
```

### Step 3: Backfill `player_game_stats` using API-Sports player IDs

When inserting stats, look up `player_id` by `api_sports_id`:

```javascript
// Get stats from API-Sports
const apiPlayerStats = await fetchFromApiSports(...);

// For each player's stats:
const { data: player } = await supabase
  .from('players')
  .select('id')
  .eq('api_sports_id', apiPlayerStats.player.id)
  .single();

// Insert stats with correct player_id
await supabase
  .from('player_game_stats')
  .insert({
    player_id: player.id,  // ← Now matches players table
    game_date: '2024-12-01',
    receptions: 5,
    receiving_yards: 67,
    ...
  });
```

## Quick Fix (Without Full Backfill)

If you want AI to work **immediately** without backfilling historical stats:

### Option A: Use ESPN live stats (what `refresh-player-stats` does)

Modify `getPlayerStats()` to fetch ESPN box scores on-demand when DB has no data:

```javascript
async getPlayerStats(playerName, team, statType, lastNGames) {
  // Try DB first
  const dbStats = await this.queryDatabase(playerName);
  
  if (dbStats && dbStats.length > 0) {
    return dbStats;
  }
  
  // Fallback: fetch live from ESPN
  console.log(`⚡ Fetching live stats for ${playerName} from ESPN`);
  const liveStats = await this.fetchESPNBoxScores(playerName, lastNGames);
  return liveStats;
}
```

### Option B: Skip props without stats

Force AI to only select player props where stats exist (already implemented in your prompt update):

```
4. **For PLAYER PROPS:** Use `get_player_stats()` function call to retrieve concrete stats.
   If you cannot retrieve player stats via function call, DO NOT SELECT that player prop - 
   skip it entirely and choose a different bet with verified data.
```

## Recommended Approach

**Short term (today):**
1. Run the roster sync script I created (syncs 5 teams to save API quota)
2. Commit and deploy the AI function fixes (lookup by player_id correctly)
3. Let AI skip props without data

**Medium term (this week):**
1. Set up daily cron to sync all 32 NFL team rosters
2. Backfill last 3 weeks of player_game_stats from API-Sports
3. Update `refresh-player-stats` edge function to write to DB, not just return JSON

**Long term (next sprint):**
1. Build a player identity resolution service (handles name variations: "D.K. Metcalf" vs "DK Metcalf")
2. Sync rosters for NBA/MLB/NHL
3. Add trade/transaction tracking

## Files to Update

1. **Database migration**: `database/migrations/add_api_sports_id_to_players.sql`
2. **Roster sync cron**: `supabase/functions/refresh-rosters/index.ts` (replace stub)
3. **Stats backfill script**: `scripts/backfill_player_stats.js`
4. **AI function**: Already fixed in `lib/services/ai-functions.js`

## Test After Sync

```bash
# 1. Run roster sync
node scripts/sync_players_and_stats.js

# 2. Check Tyrone Tracy Jr. specifically
node scripts/check_player_data.js

# 3. Generate fresh suggestions
# → Should now find stats or skip the prop cleanly
```
