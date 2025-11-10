-- Test Edge Functions manually to verify they work
-- Run these one at a time in Supabase SQL Editor

-- 1. Test refresh-odds Edge Function
select net.http_post(
  url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/refresh-odds',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
  ),
  body := '{}',
  timeout_milliseconds := 300000
) as odds_test;

-- 2. Test sync-sports-stats Edge Function  
select net.http_post(
  url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/sync-sports-stats',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
  ),
  body := '{}',
  timeout_milliseconds := 600000
) as stats_test;

-- 3. Test refresh-sports-intelligence Edge Function
select net.http_post(
  url := 'https://pcjhulzyqmhrhsrgvwvx.functions.supabase.co/functions/v1/refresh-sports-intelligence',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs'
  ),
  body := '{}',
  timeout_milliseconds := 300000
) as news_test;