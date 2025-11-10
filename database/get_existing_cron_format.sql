-- Check existing cron job commands to get your Supabase URL and keys
-- Run this to see the exact format of your existing jobs

SELECT 
    jobname,
    command
FROM cron.job 
WHERE jobname LIKE '%refresh%'
LIMIT 3;