-- Check if RSS ingestion worked
-- Run this in Supabase SQL Editor

-- 1. Count articles
SELECT COUNT(*) as total_articles FROM news_articles;

-- 2. View recent articles
SELECT 
  id,
  title,
  published_at,
  fetched_at,
  LENGTH(content) as content_length
FROM news_articles 
ORDER BY fetched_at DESC 
LIMIT 10;

-- 3. Check by source
SELECT 
  ns.name,
  COUNT(na.id) as article_count
FROM news_sources ns
LEFT JOIN news_articles na ON na.source_id = ns.id
GROUP BY ns.id, ns.name
ORDER BY article_count DESC;

-- 4. Check cron logs
SELECT 
  id,
  job_name,
  status,
  details,
  created_at
FROM cron_job_logs
WHERE job_name IN ('ingest-news-lite', 'ingest-news')
ORDER BY created_at DESC
LIMIT 10;
