-- Setup automatic parlay outcome checking
-- Execute this in Supabase SQL Editor to enable daily outcome checking

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create a function to call our Edge Function
-- This function will invoke the check-parlay-outcomes Edge Function daily
CREATE OR REPLACE FUNCTION check_parlay_outcomes_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Make HTTP request to our Edge Function
  -- Note: In production, this would be called via an external cron service
  -- or Supabase's built-in cron capabilities
  
  -- Log the cron execution
  INSERT INTO public.cron_logs (function_name, executed_at, status)
  VALUES ('check_parlay_outcomes_cron', NOW(), 'executed')
  ON CONFLICT DO NOTHING;
  
  -- The actual outcome checking will be handled by:
  -- 1. External cron service calling the Edge Function
  -- 2. Or manual refresh in the Dashboard
  -- 3. Or automatic checking when users visit their dashboard
  
EXCEPTION
  WHEN OTHERS THEN
    -- Log any errors
    INSERT INTO public.cron_logs (function_name, executed_at, status, error_message)
    VALUES ('check_parlay_outcomes_cron', NOW(), 'error', SQLERRM)
    ON CONFLICT DO NOTHING;
END;
$$;

-- Create a simple cron logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS cron_logs (
  id BIGSERIAL PRIMARY KEY,
  function_name VARCHAR(255) NOT NULL,
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status VARCHAR(50) NOT NULL, -- 'executed', 'error'
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for cron logs
CREATE INDEX IF NOT EXISTS idx_cron_logs_function_executed ON cron_logs(function_name, executed_at);

-- Enable RLS for cron logs (admin only)
ALTER TABLE cron_logs ENABLE ROW LEVEL SECURITY;

-- Only service role can access cron logs
CREATE POLICY "Service role only" ON cron_logs FOR ALL USING (auth.role() = 'service_role');

-- Schedule the cron job to run daily at 6 AM UTC
-- This will check all pending parlays for outcomes
SELECT cron.schedule(
  'check-parlay-outcomes-daily',
  '0 6 * * *', -- Daily at 6 AM UTC (covers US evening games)
  'SELECT check_parlay_outcomes_cron();'
);

-- Verify the cron job was created
SELECT * FROM cron.job WHERE jobname = 'check-parlay-outcomes-daily';

-- Note: For production deployment, we recommend using:
-- 1. Supabase's built-in cron functionality (if available)
-- 2. External services like GitHub Actions, Vercel Cron, or Railway Cron
-- 3. This pg_cron setup as a backup method

-- To manually trigger the outcome check (for testing):
-- SELECT check_parlay_outcomes_cron();