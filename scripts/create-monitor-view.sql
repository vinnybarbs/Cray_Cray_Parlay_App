-- Create a simple monitoring view
-- Run this ONCE in Supabase SQL Editor

DROP VIEW IF EXISTS settlement_monitor;

CREATE VIEW settlement_monitor AS
SELECT 
  COUNT(*) FILTER (WHERE was_locked_by_user = true) as total_locked_picks,
  COUNT(*) FILTER (WHERE was_locked_by_user = true AND actual_outcome = 'pending') as pending_picks,
  COUNT(*) FILTER (WHERE was_locked_by_user = true AND actual_outcome IN ('won', 'lost', 'push')) as settled_picks,
  COUNT(*) FILTER (WHERE was_locked_by_user = true AND actual_outcome = 'won') as wins,
  COUNT(*) FILTER (WHERE was_locked_by_user = true AND actual_outcome = 'lost') as losses,
  (SELECT COUNT(*) FROM parlays WHERE status = 'pending') as pending_parlays,
  (SELECT COUNT(*) FROM parlays WHERE status = 'completed') as completed_parlays
FROM ai_suggestions;

-- Then query it
SELECT * FROM settlement_monitor;
