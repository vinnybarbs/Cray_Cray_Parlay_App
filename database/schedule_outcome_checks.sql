-- Schedule outcome checking cron jobs
-- Runs daily at midnight and 6am to validate parlays and AI suggestions

-- Midnight run (catch most late games)
SELECT cron.schedule(
  'check-outcomes-midnight',
  '0 0 * * *', -- Every day at midnight
  $$
    SELECT net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/check-outcomes',
      headers := jsonb_build_object(
        'Authorization', 
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzOTg1MTUsImV4cCI6MjA3Nzk3NDUxNX0.1O92kXamxlOLuBnF0H-pNUPxXnd2bxLqToKlqobH5Wc'
      )
    );
  $$
);

-- Morning run (catch very late games and West Coast games)
SELECT cron.schedule(
  'check-outcomes-morning',
  '0 6 * * *', -- Every day at 6am
  $$
    SELECT net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/check-outcomes',
      headers := jsonb_build_object(
        'Authorization', 
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzOTg1MTUsImV4cCI6MjA3Nzk3NDUxNX0.1O92kXamxlOLuBnF0H-pNUPxXnd2bxLqToKlqobH5Wc'
      )
    );
  $$
);

-- Verify schedules were created
SELECT * FROM cron.job WHERE jobname LIKE 'check-outcomes%';
