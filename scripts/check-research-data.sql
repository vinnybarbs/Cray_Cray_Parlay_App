-- Check if your research infrastructure has data

-- 1. Check team stats
SELECT 
  'Team Stats' as table_name,
  COUNT(*) as total_records,
  COUNT(DISTINCT season) as seasons,
  COUNT(DISTINCT team_id) as teams,
  MAX(season) as latest_season
FROM team_stats_season;

-- 2. Check news articles
SELECT 
  'News Articles' as table_name,
  COUNT(*) as total_articles,
  COUNT(DISTINCT source_id) as sources,
  MAX(published_at) as latest_article,
  COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '7 days') as articles_last_7_days
FROM news_articles;

-- 3. Sample some news articles
SELECT 
  title,
  source_id,
  published_at,
  LENGTH(content) as content_length
FROM news_articles
WHERE published_at >= NOW() - INTERVAL '7 days'
ORDER BY published_at DESC
LIMIT 10;

-- 4. Check what teams have stats for current season
SELECT 
  t.name as team_name,
  ts.season,
  ts.metrics->>'wins' as wins,
  ts.metrics->>'losses' as losses
FROM team_stats_season ts
JOIN teams t ON t.id = ts.team_id
WHERE ts.season = CASE 
  WHEN EXTRACT(MONTH FROM NOW()) < 8 THEN EXTRACT(YEAR FROM NOW()) - 1
  ELSE EXTRACT(YEAR FROM NOW())
END
ORDER BY t.name
LIMIT 20;

-- 5. Check if news articles mention actual teams
SELECT 
  source_id,
  COUNT(*) as article_count,
  MAX(published_at) as latest
FROM news_articles
WHERE published_at >= NOW() - INTERVAL '7 days'
  AND (
    title ILIKE '%falcons%' OR content ILIKE '%falcons%' OR
    title ILIKE '%jets%' OR content ILIKE '%jets%'
  )
GROUP BY source_id;
