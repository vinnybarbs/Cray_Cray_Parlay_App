-- ============================================================================
-- IMMEDIATE ACTION ITEMS - Based on your current cache status
-- ============================================================================
-- Run these commands to fix your missing data issues
-- ============================================================================

-- Your current status shows you need to populate missing caches:
-- ❌ team_stats_cache: 0 records (critical for AI analysis)
-- ❌ news_cache: 0 records (critical for injury/news insights) 
-- ⚠️ odds_cache: 15.2 hours stale (needs refresh)

-- ============================================================================
-- PRIORITY 1: POPULATE TEAM STATS CACHE (Critical)
-- ============================================================================
-- Your AI needs team performance data for genuine analytical edge detection
-- Current status: 0 records = AI is flying blind on team metrics

-- Run this in terminal:
-- curl -X POST "http://localhost:5001/api/refresh-stats"

-- What this does:
-- - Fetches team statistics for NFL, NBA, NHL, etc. from API-Sports
-- - Stores offensive/defensive metrics, recent form, head-to-head records
-- - Enables AI to find line value edges based on team performance gaps

-- ============================================================================
-- PRIORITY 2: POPULATE NEWS CACHE (Critical)  
-- ============================================================================
-- Your AI needs current injury reports and analyst insights
-- Current status: 0 records = Missing injury/news context for picks

-- Run this in terminal:
-- curl -X POST "http://localhost:5001/api/refresh-news"

-- What this does:
-- - Searches for injury reports, lineup changes, analyst picks
-- - Uses Serper to get breaking news that affects line value
-- - Provides situational and information edge detection data

-- ============================================================================
-- PRIORITY 3: REFRESH STALE ODDS (Medium)
-- ============================================================================
-- Your odds are 15.2 hours old (lines have moved significantly)
-- Current status: Stale data = AI using outdated line values

-- Run this in terminal:  
-- curl -X POST "http://localhost:5001/api/refresh-odds"

-- What this does:
-- - Fetches current odds from DraftKings, FanDuel, BetMGM
-- - Updates moneyline, spread, and total markets
-- - Ensures AI edge detection uses current market prices

-- ============================================================================
-- VERIFY SUCCESS - Run after each API call
-- ============================================================================

-- Check if team stats populated:
SELECT 'Team Stats Check' as check, sport, COUNT(*) as teams, MAX(last_updated) as refreshed 
FROM team_stats_cache GROUP BY sport;

-- Check if news populated:
SELECT 'News Check' as check, sport, search_type, COUNT(*) as articles, MAX(last_updated) as refreshed
FROM news_cache GROUP BY sport, search_type;

-- Check if odds refreshed:
SELECT 'Odds Check' as check, sport, COUNT(*) as odds, MAX(last_updated) as refreshed,
       ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(last_updated)))/3600, 1) as hours_old
FROM odds_cache GROUP BY sport;

-- ============================================================================
-- EXPECTED RESULTS AFTER FIXES
-- ============================================================================

-- After running all three refresh commands, you should see:
-- ✅ team_stats_cache: 100+ records (teams across multiple sports)
-- ✅ news_cache: 50+ records (injury reports, analyst picks, team news)  
-- ✅ odds_cache: <2 hours old (fresh market data)

-- This will transform your AI from basic pick generation to:
-- 🎯 LINE VALUE EDGES: Team metrics vs market pricing  
-- 🎯 SITUATIONAL EDGES: Injury impacts, rest advantages
-- 🎯 INFORMATION EDGES: Breaking news not yet priced in
-- 🎯 CONTRARIAN EDGES: Public bias creating value

-- ============================================================================
-- AUTOMATION SETUP (Optional)
-- ============================================================================

-- Consider setting up cron jobs for automatic refreshing:
-- */30 * * * * curl -X POST "http://localhost:5001/api/refresh-odds"     # Every 30 min
-- 0 6 * * * curl -X POST "http://localhost:5001/api/refresh-stats"       # Daily at 6 AM  
-- 0 */6 * * * curl -X POST "http://localhost:5001/api/refresh-news"      # Every 6 hours