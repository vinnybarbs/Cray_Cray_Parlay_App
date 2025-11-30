-- ============================================================================
-- REAL-TIME SETTLEMENT MONITORING
-- Run these queries to track settlement progress
-- ============================================================================

-- 1. SETTLEMENT PROGRESS OVERVIEW
-- Shows how many picks have been checked and settled
SELECT 
  '🎯 SETTLEMENT PROGRESS' as status,
  COUNT(*) as total_picks,
  COUNT(*) FILTER (WHERE was_locked_by_user = true) as user_locked_picks,
  COUNT(*) FILTER (WHERE actual_outcome = 'pending') as pending,
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as won,
  COUNT(*) FILTER (WHERE actual_outcome = 'lost') as lost,
  COUNT(*) FILTER (WHERE actual_outcome = 'push') as push,
  ROUND(
    COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost', 'push')) * 100.0 / 
    NULLIF(COUNT(*), 0),
    1
  ) as percent_settled
FROM ai_suggestions;

-- 2. GAMES READY TO SETTLE
-- Shows which games should be checkable now (4+ hours after game time)
SELECT 
  game_date,
  sport,
  home_team,
  away_team,
  COUNT(*) as picks_count,
  ROUND(EXTRACT(EPOCH FROM (NOW() - game_date)) / 3600, 1) as hours_since_game,
  MAX(actual_outcome) as current_status
FROM ai_suggestions
WHERE was_locked_by_user = true
  AND actual_outcome = 'pending'
  AND game_date < NOW() - INTERVAL '4 hours'
GROUP BY game_date, sport, home_team, away_team
ORDER BY game_date DESC
LIMIT 20;

-- 3. RECENT SETTLEMENTS
-- Shows picks that were recently settled
SELECT 
  resolved_at::date as settlement_date,
  COUNT(*) as picks_settled,
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as wins,
  COUNT(*) FILTER (WHERE actual_outcome = 'lost') as losses,
  COUNT(*) FILTER (WHERE actual_outcome = 'push') as pushes
FROM ai_suggestions
WHERE was_locked_by_user = true
  AND resolved_at IS NOT NULL
GROUP BY resolved_at::date
ORDER BY resolved_at::date DESC
LIMIT 7;

-- 4. PARLAY STATUS BREAKDOWN
-- Shows status of all parlays
SELECT 
  status,
  COUNT(*) as parlay_count,
  ROUND(AVG(total_legs), 1) as avg_legs,
  COUNT(*) FILTER (WHERE final_outcome = 'won') as won,
  COUNT(*) FILTER (WHERE final_outcome = 'lost') as lost,
  COUNT(*) FILTER (WHERE final_outcome = 'push') as push
FROM parlays
GROUP BY status
ORDER BY 
  CASE status 
    WHEN 'pending' THEN 1 
    WHEN 'completed' THEN 2 
    ELSE 3 
  END;

-- 5. GAMES THAT NEED MANUAL CHECK
-- Games that happened but settlement might have failed
SELECT 
  s.game_date,
  s.sport,
  s.home_team || ' vs ' || s.away_team as matchup,
  COUNT(*) as affected_picks,
  ROUND(EXTRACT(EPOCH FROM (NOW() - s.game_date)) / 3600, 1) as hours_ago,
  'Check ESPN/ESPN API manually' as action
FROM ai_suggestions s
WHERE s.was_locked_by_user = true
  AND s.actual_outcome = 'pending'
  AND s.game_date < NOW() - INTERVAL '12 hours'  -- Over 12 hours old
GROUP BY s.game_date, s.sport, s.home_team, s.away_team
ORDER BY s.game_date DESC
LIMIT 10;

-- 6. DETAILED PICK STATUS
-- Show individual picks and their status
SELECT 
  s.id,
  s.game_date,
  s.sport,
  s.home_team || ' vs ' || s.away_team as game,
  s.bet_type,
  s.pick,
  s.odds,
  s.actual_outcome,
  CASE 
    WHEN s.actual_outcome != 'pending' THEN '✅ Settled'
    WHEN s.game_date > NOW() THEN '⏰ Future'
    WHEN s.game_date > NOW() - INTERVAL '4 hours' THEN '🏈 In Progress'
    ELSE '⚠️ Needs Settlement'
  END as status,
  ROUND(EXTRACT(EPOCH FROM (NOW() - s.game_date)) / 3600, 1) as hours_since_game
FROM ai_suggestions s
WHERE s.was_locked_by_user = true
ORDER BY s.game_date DESC, s.id
LIMIT 50;

-- 7. QUICK WIN RATE SNAPSHOT (Live)
-- Shows current win rate based on settled picks
SELECT 
  'CURRENT WIN RATES' as metric,
  COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost', 'push')) as settled_picks,
  ROUND(
    COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 / 
    NULLIF(COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')), 0),
    1
  ) as win_rate_percent,
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as wins,
  COUNT(*) FILTER (WHERE actual_outcome = 'lost') as losses,
  COUNT(*) FILTER (WHERE actual_outcome = 'push') as pushes,
  COUNT(*) FILTER (WHERE actual_outcome = 'pending') as still_pending
FROM ai_suggestions
WHERE was_locked_by_user = true;

-- ============================================================================
-- AUTO-REFRESH VIEW: Run this to create a live monitoring view
-- ============================================================================
CREATE OR REPLACE VIEW settlement_monitor AS
SELECT 
  -- Overall Progress
  COUNT(*) FILTER (WHERE was_locked_by_user = true) as total_locked_picks,
  COUNT(*) FILTER (WHERE was_locked_by_user = true AND actual_outcome = 'pending') as pending_picks,
  COUNT(*) FILTER (WHERE was_locked_by_user = true AND actual_outcome IN ('won', 'lost', 'push')) as settled_picks,
  
  -- Win Rate
  ROUND(
    COUNT(*) FILTER (WHERE was_locked_by_user = true AND actual_outcome = 'won') * 100.0 / 
    NULLIF(COUNT(*) FILTER (WHERE was_locked_by_user = true AND actual_outcome IN ('won', 'lost')), 0),
    1
  ) as current_win_rate,
  
  -- Games Ready to Settle
  COUNT(*) FILTER (
    WHERE was_locked_by_user = true 
    AND actual_outcome = 'pending' 
    AND game_date < NOW() - INTERVAL '4 hours'
  ) as games_ready_to_settle,
  
  -- Parlays
  (SELECT COUNT(*) FROM parlays WHERE status = 'pending') as pending_parlays,
  (SELECT COUNT(*) FROM parlays WHERE status = 'completed') as completed_parlays,
  
  -- Last Settlement Run
  MAX(resolved_at) as last_settlement_at
FROM ai_suggestions;

-- Query the monitor
SELECT * FROM settlement_monitor;

-- ============================================================================
-- SETTLEMENT HEALTH CHECK
-- ============================================================================
SELECT 
  CASE 
    WHEN pending_picks = 0 THEN '✅ All picks settled!'
    WHEN games_ready_to_settle = 0 THEN '⏰ Waiting for games to finish'
    WHEN games_ready_to_settle > 0 AND last_settlement_at < NOW() - INTERVAL '2 hours' 
      THEN '⚠️ Settlement may be stuck - run manually'
    WHEN games_ready_to_settle > 0 
      THEN '🔄 Games ready - settlement should run soon'
    ELSE '✅ System healthy'
  END as health_status,
  *
FROM settlement_monitor;
