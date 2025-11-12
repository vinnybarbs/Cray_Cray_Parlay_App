-- Fix Row Level Security policies for Edge Functions
-- Run this in Supabase SQL Editor to allow service_role to write to cache tables

-- Add service_role policies for cache tables that edge functions need to write to

-- Odds cache tables (only if they exist)
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'odds_cache') THEN
        EXECUTE 'CREATE POLICY "Service role can manage odds_cache" ON odds_cache FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
END $$;

-- News cache tables  
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'news_cache') THEN
        EXECUTE 'CREATE POLICY "Service role can manage news_cache" ON news_cache FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
END $$;

-- Sports stats cache tables
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'team_stats_cache') THEN
        EXECUTE 'CREATE POLICY "Service role can manage team_stats_cache" ON team_stats_cache FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
END $$;

DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'player_stats_cache') THEN
        EXECUTE 'CREATE POLICY "Service role can manage player_stats_cache" ON player_stats_cache FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
END $$;

DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'standings_cache') THEN
        EXECUTE 'CREATE POLICY "Service role can manage standings_cache" ON standings_cache FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
END $$;

DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'injuries_cache') THEN
        EXECUTE 'CREATE POLICY "Service role can manage injuries_cache" ON injuries_cache FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
END $$;

DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'h2h_cache') THEN
        EXECUTE 'CREATE POLICY "Service role can manage h2h_cache" ON h2h_cache FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
END $$;

-- API call logging
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'api_call_log') THEN
        EXECUTE 'CREATE POLICY "Service role can manage api_call_log" ON api_call_log FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
END $$;

-- Team and player stats tables
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'team_stats') THEN
        EXECUTE 'CREATE POLICY "Service role can manage team_stats" ON team_stats FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
END $$;

DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'player_stats') THEN
        EXECUTE 'CREATE POLICY "Service role can manage player_stats" ON player_stats FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
END $$;

DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'game_results') THEN
        EXECUTE 'CREATE POLICY "Service role can manage game_results" ON game_results FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
END $$;

-- Enhanced stats tables
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'team_season_stats') THEN
        EXECUTE 'CREATE POLICY "Service role can manage team_season_stats" ON team_season_stats FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
END $$;

DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'player_season_stats') THEN
        EXECUTE 'CREATE POLICY "Service role can manage player_season_stats" ON player_season_stats FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
END $$;

-- Betting trends cache
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'betting_trends_cache') THEN
        EXECUTE 'CREATE POLICY "Service role can manage betting_trends_cache" ON betting_trends_cache FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
END $$;

-- Cron job monitoring
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'cron_runs') THEN
        EXECUTE 'CREATE POLICY "Service role can manage cron_runs" ON cron_runs FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
END $$;

-- Game research cache
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'game_research_cache') THEN
        EXECUTE 'CREATE POLICY "Service role can manage game_research_cache" ON game_research_cache FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
END $$;

-- Stats sync log
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'stats_sync_log') THEN
        EXECUTE 'CREATE POLICY "Service role can manage stats_sync_log" ON stats_sync_log FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
END $$;

-- Verify policies were created
SELECT schemaname, tablename, policyname, roles, cmd 
FROM pg_policies 
WHERE 'service_role' = ANY(roles::text[])
ORDER BY tablename, policyname;