# API Sports Stats Caching Setup

## 📋 Overview

This Edge Function syncs player and team statistics from API Sports to Supabase daily, optimizing your 100 calls/day budget.

## 🏗️ Architecture

```
┌─────────────────────────────────────┐
│   Supabase Edge Function            │
│   (sync-sports-stats)               │
├─────────────────────────────────────┤
│ Runs: 2 AM daily (off-peak)         │
│ Budget: 100 calls/day allocated:    │
│  • NFL: 40 calls (40%)              │
│  • NBA: 25 calls (25%)              │  
│  • NCAAF: 20 calls (20%)            │
│  • Buffer: 15 calls (15%)           │
└─────────────────────────────────────┘
         ↓ (fetches from)
┌─────────────────────────────────────┐
│   API Sports API                    │
│   (RapidAPI endpoints)              │
├─────────────────────────────────────┤
│ /teams - Team info & standings      │
│ /players/statistics - Player stats  │
│ /games - Schedule & results         │
└─────────────────────────────────────┘
         ↓ (stores to)
┌─────────────────────────────────────┐
│   Supabase PostgreSQL               │
├─────────────────────────────────────┤
│ Tables:                             │
│  - team_stats (teams & records)     │
│  - player_stats (season stats)      │  
│  - game_results (schedule/scores)   │
│  - api_call_log (budget tracking)   │
└─────────────────────────────────────┘
```

## 🚀 Setup Steps

### 1. Create Database Schema

Run `database/sports_stats_schema.sql` in Supabase SQL Editor:

```sql
-- Creates tables: team_stats, player_stats, game_results, api_call_log
-- With indexes and constraints for performance
```

### 2. Deploy Edge Function  

```bash
cd /path/to/your/project
supabase functions deploy sync-sports-stats
```

### 3. Set Environment Variables

In Supabase Dashboard → Project Settings → Edge Functions:

```bash
APISPORTS_API_KEY=your_rapidapi_key_here
SUPABASE_URL=https://your-project.supabase.co  
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 4. Schedule with pg_cron

Run in Supabase SQL Editor:

```sql
-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily sync at 2 AM 
SELECT cron.schedule(
  'daily-sports-stats-sync',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://your-project-ref.functions.supabase.co/functions/v1/sync-sports-stats',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    ),
    body := '{}',
    timeout_milliseconds := 300000
  ) as request_id;
  $$
);
```

### 5. Test the Function

```bash
curl -X POST https://your-project.functions.supabase.co/functions/v1/sync-sports-stats \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -d '{}'
```

## 📊 Budget Management

### Daily Allocation
- **Total**: 100 calls/day
- **NFL**: 40 calls (teams + top 100 players)
- **NBA**: 25 calls (teams + top 100 players)  
- **NCAAF**: 20 calls (teams + top 100 players)
- **Buffer**: 15 calls (retries, extras)

### Smart Features
- ✅ **Budget tracking** - Logs daily usage
- ✅ **Auto-skip** - Stops when budget exhausted  
- ✅ **Priority system** - NFL first, then NBA, then NCAAF
- ✅ **Retry logic** - Handles rate limits & failures
- ✅ **Efficient caching** - 7-day cache TTL

## 🔍 Monitoring

### Check API Usage
```sql
SELECT date, calls_used, sports_synced 
FROM api_call_log 
ORDER BY date DESC 
LIMIT 7;
```

### Check Stats Count
```sql
-- Teams by sport
SELECT sport, COUNT(*) as teams 
FROM team_stats 
GROUP BY sport;

-- Players by sport  
SELECT sport, COUNT(*) as players
FROM player_stats 
GROUP BY sport;
```

### Check Recent Updates
```sql
SELECT sport, team_name, last_updated
FROM team_stats
WHERE last_updated > NOW() - INTERVAL '24 hours'
ORDER BY last_updated DESC;
```

## 🎯 Integration with Your Agents

Your agents can now query cached stats instead of live API calls:

```javascript
// Example: Get NFL team stats
const { data: nflTeams } = await supabase
  .from('team_stats')
  .select('*')
  .eq('sport', 'NFL')
  .eq('season', '2024');

// Example: Get player stats for analysis
const { data: playerStats } = await supabase
  .from('player_stats')  
  .select('*')
  .eq('sport', 'NFL')
  .eq('team_id', teamId)
  .order('stats_json->passing_yards', { ascending: false });
```

## 🛠️ Customization

### Add More Sports
Edit `SPORTS_CONFIG` in the Edge Function:

```typescript
NCAAH: {
  baseUrl: 'https://v1.basketball.api-sports.io',
  host: 'v1.basketball.api-sports.io', 
  season: '2024-2025',
  priority: 4
}
```

### Adjust Budget Allocation
Edit `DAILY_BUDGET.allocation`:

```typescript
allocation: {
  NFL: 50,      // Increase NFL allocation
  NBA: 20,      // Decrease others
  NCAAF: 15,    
  buffer: 15
}
```

### Change Schedule
Modify cron expression in pg_cron:
- `0 2 * * *` = 2 AM daily
- `0 */12 * * *` = Every 12 hours
- `0 6 * * 1` = 6 AM every Monday

## 🆘 Troubleshooting

### Function Not Running
1. Check pg_cron jobs: `SELECT * FROM cron.job;`
2. Check function logs in Supabase Dashboard
3. Verify environment variables are set

### High API Usage  
1. Check `api_call_log` table for spikes
2. Reduce budget allocation if needed
3. Increase cache TTL to reduce frequency

### Data Not Updating
1. Check if API key is valid
2. Verify API Sports endpoints haven't changed
3. Check function error logs

## 🎉 Benefits

- ✅ **No more live API calls** during parlay generation
- ✅ **Rich player/team data** for better AI analysis
- ✅ **Budget protection** - Never exceed 100 calls/day
- ✅ **Automatic updates** - Fresh data daily
- ✅ **Performance** - Instant queries from cache
- ✅ **Scalable** - Supports all sports you need