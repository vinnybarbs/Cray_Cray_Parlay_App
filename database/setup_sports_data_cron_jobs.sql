-- SPORTS TEAM & PLAYER STATS CRON JOBS
-- Updates dynamic sports data while keeping static team data intact
-- Runs at different intervals based on data volatility

-- 1. Team Performance Stats (Daily at 6 AM)
-- Updates wins/losses, recent performance for all sports
SELECT cron.schedule(
  'refresh-team-stats-daily',
  '0 6 * * *', -- Daily at 6 AM
  $$
    -- Ensure pg_net is enabled
    SELECT ensure_pg_net_enabled();
    
    -- Call team stats refresh endpoint
    SELECT pg_net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/refresh-team-stats',
      headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs", "Content-Type": "application/json"}',
      body := '{"automated": true, "sports": ["NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB"]}'
    );
  $$
);

-- 2. Player Stats Refresh (Daily at 7 AM)
-- Updates player performance data for active seasons
SELECT cron.schedule(
  'refresh-player-stats-daily',
  '0 7 * * *', -- Daily at 7 AM  
  $$
    -- Ensure pg_net is enabled
    SELECT ensure_pg_net_enabled();
    
    -- Call player stats refresh endpoint
    SELECT pg_net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/refresh-player-stats',
      headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs", "Content-Type": "application/json"}',
      body := '{"automated": true, "season": 2025}'
    );
  $$
);

-- 3. Injury Reports (Every 4 hours during active seasons)
-- Critical for player props accuracy
SELECT cron.schedule(
  'refresh-injury-reports',
  '0 */4 * * *', -- Every 4 hours
  $$
    -- Ensure pg_net is enabled
    SELECT ensure_pg_net_enabled();
    
    -- Call injury report refresh endpoint
    SELECT pg_net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/refresh-injuries',
      headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs", "Content-Type": "application/json"}',
      body := '{"automated": true, "sports": ["NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB"]}'
    );
  $$
);

-- 4. Roster Updates (Weekly on Mondays at 8 AM)
-- Updates team rosters for current season player-team assignments
SELECT cron.schedule(
  'refresh-rosters-weekly',
  '0 8 * * 1', -- Mondays at 8 AM
  $$
    -- Ensure pg_net is enabled
    SELECT ensure_pg_net_enabled();
    
    -- Call roster refresh endpoint
    SELECT pg_net.http_post(
      url := 'https://pcjhulzyqmhrhsrgvwvx.supabase.co/functions/v1/refresh-rosters',
      headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjamh1bHp5cW1ocmhzcmd2d3Z4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM5ODUxNSwiZXhwIjoyMDc3OTc0NTE1fQ.KR4JOR5_2f6rX7gR4-SlxVLGlbWyVuZv77WQTOSm2Bs", "Content-Type": "application/json"}',
      body := '{"automated": true, "season": 2025, "sports": ["NFL", "NBA", "MLB", "NHL"]}'
    );
  $$
);

-- 5. Team Cache Health Check (Daily at 5 AM)
-- Ensures team cache integrity and fills any gaps
SELECT cron.schedule(
  'team-cache-health-check',
  '0 5 * * *', -- Daily at 5 AM
  $$
    -- Direct SQL check for team cache completeness
    DO $$
    DECLARE
        nfl_count INTEGER;
        nba_count INTEGER;
        mlb_count INTEGER;
        nhl_count INTEGER;
        ncaaf_count INTEGER;
        ncaab_count INTEGER;
    BEGIN
        -- Count teams by sport
        SELECT COUNT(*) INTO nfl_count FROM team_stats_cache WHERE sport = 'NFL';
        SELECT COUNT(*) INTO nba_count FROM team_stats_cache WHERE sport = 'NBA';
        SELECT COUNT(*) INTO mlb_count FROM team_stats_cache WHERE sport = 'MLB';
        SELECT COUNT(*) INTO nhl_count FROM team_stats_cache WHERE sport = 'NHL';
        SELECT COUNT(*) INTO ncaaf_count FROM team_stats_cache WHERE sport = 'NCAAF';
        SELECT COUNT(*) INTO ncaab_count FROM team_stats_cache WHERE sport = 'NCAAB';
        
        -- Log the counts
        INSERT INTO cron_job_logs (job_name, status, details, created_at)
        VALUES (
            'team-cache-health-check',
            'completed',
            format('Team counts: NFL=%s, NBA=%s, MLB=%s, NHL=%s, NCAAF=%s, NCAAB=%s', 
                   nfl_count, nba_count, mlb_count, nhl_count, ncaaf_count, ncaab_count),
            NOW()
        );
        
        -- Alert if any sport has too few teams
        IF nfl_count < 30 OR nba_count < 25 OR mlb_count < 25 OR nhl_count < 30 THEN
            INSERT INTO cron_job_logs (job_name, status, details, created_at)
            VALUES (
                'team-cache-health-check',
                'warning',
                'Some sports have insufficient team counts - may need repopulation',
                NOW()
            );
        END IF;
    END $$;
  $$
);

-- Create cron job logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS cron_job_logs (
    id SERIAL PRIMARY KEY,
    job_name VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL, -- 'completed', 'failed', 'warning'
    details TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_cron_logs_job_date ON cron_job_logs(job_name, created_at DESC);

-- Comment explaining the strategy
/*
SPORTS DATA CRON STRATEGY:

STATIC DATA (Never changes):
- Team names and IDs (already populated: 995 teams)
- League structures
- Historical team info

DYNAMIC DATA (Updated by cron jobs):
- Team performance stats (W/L records, recent form)
- Player statistics (season stats, per-game averages)  
- Injury reports (critical for player props)
- Roster assignments (player-team relationships)

SCHEDULE RATIONALE:
- Team stats: Daily (games happen daily)
- Player stats: Daily (stats accumulate daily)
- Injuries: Every 4 hours (can change quickly)
- Rosters: Weekly (trades/signings less frequent)
- Health checks: Daily (ensure system integrity)

This separates static team data (fast lookups) from dynamic sports data (regular updates).
*/