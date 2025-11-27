-- Check RSS news setup

-- 1. Check news_sources table
SELECT 
  'Total sources' as metric,
  COUNT(*) as value
FROM news_sources;

-- 2. See what sources exist
SELECT 
  id,
  name,
  feed_url,
  created_at,
  last_fetched
FROM news_sources
ORDER BY created_at DESC;

-- 3. Check articles
SELECT 
  'Total articles' as metric,
  COUNT(*) as value
FROM news_articles;

-- 4. Check cron schedule
SELECT 
  jobname,
  schedule,
  active,
  command
FROM cron.job
WHERE jobname LIKE '%news%'
ORDER BY jobname;
