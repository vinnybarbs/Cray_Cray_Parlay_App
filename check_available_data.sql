-- Check what NFL data we have available for reasoning

-- 1. Team stats from standings ingestion
SELECT 
  COUNT(*) as team_count,
  COUNT(DISTINCT season) as seasons
FROM team_stats_season 
WHERE season >= 2024;

-- 2. Sample team stats to see what metrics we have
SELECT 
  team_id,
  season,
  metrics
FROM team_stats_season 
WHERE season = 2024
LIMIT 3;

-- 3. News articles count
SELECT 
  COUNT(*) as total_articles,
  COUNT(CASE WHEN published_at > NOW() - INTERVAL '24 hours' THEN 1 END) as last_24h,
  COUNT(CASE WHEN published_at > NOW() - INTERVAL '7 days' THEN 1 END) as last_7_days
FROM news_articles;

-- 4. Player stats in cache
SELECT 
  COUNT(*) as player_stat_records
FROM player_stats_cache
WHERE fetched_at > NOW() - INTERVAL '24 hours';

-- 5. Odds cache variety
SELECT 
  market_type,
  COUNT(*) as count
FROM odds_cache
WHERE sport = 'americanfootball_nfl'
  AND commence_time > NOW()
GROUP BY market_type
ORDER BY count DESC;
