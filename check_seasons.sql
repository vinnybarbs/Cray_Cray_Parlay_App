-- Check what seasons exist in team_stats_season
SELECT DISTINCT season, COUNT(*) as team_count
FROM team_stats_season
GROUP BY season
ORDER BY season DESC;

-- Also check a sample of data
SELECT season, team_id, metrics->>'wins' as wins, metrics->>'losses' as losses
FROM team_stats_season
WHERE season >= 2024
ORDER BY season DESC, team_id
LIMIT 10;
