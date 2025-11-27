-- Verify Phase 1 Setup

-- Check if tables exist
SELECT 'game_results' as table_name, COUNT(*) as row_count FROM game_results
UNION ALL
SELECT 'ai_suggestions', COUNT(*) FROM ai_suggestions
UNION ALL
SELECT 'team_aliases', COUNT(*) FROM team_aliases;

-- Check cron jobs
SELECT jobname, schedule, active 
FROM cron.job 
WHERE jobname LIKE 'check-outcomes%';

-- Check Edge Function can be called (will return immediately)
-- Run this manually:
-- curl -X POST "https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/check-outcomes" \
--   -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
