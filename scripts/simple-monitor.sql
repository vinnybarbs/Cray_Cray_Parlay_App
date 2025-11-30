-- ============================================================================
-- SIMPLE SETTLEMENT MONITORING (Basic queries that definitely work)
-- ============================================================================

-- 1. BASIC PROGRESS CHECK
SELECT 
  COUNT(*) as total_picks,
  COUNT(*) FILTER (WHERE was_locked_by_user = true) as user_locked,
  COUNT(*) FILTER (WHERE actual_outcome = 'pending') as pending,
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as won,
  COUNT(*) FILTER (WHERE actual_outcome = 'lost') as lost
FROM ai_suggestions;

-- 2. WIN RATE (Simple calculation)
SELECT 
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as wins,
  COUNT(*) FILTER (WHERE actual_outcome = 'lost') as losses,
  CASE 
    WHEN COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')) > 0 
    THEN ROUND(
      COUNT(*) FILTER (WHERE actual_outcome = 'won')::numeric * 100.0 / 
      COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost'))::numeric,
      1
    )
    ELSE 0
  END as win_rate_percent
FROM ai_suggestions
WHERE was_locked_by_user = true;

-- 3. PARLAY STATUS
SELECT 
  status,
  COUNT(*) as count
FROM parlays
GROUP BY status;

-- 4. GAMES BY DATE (See which games have picks)
SELECT 
  game_date::date as date,
  COUNT(*) as picks,
  COUNT(*) FILTER (WHERE actual_outcome != 'pending') as settled
FROM ai_suggestions
WHERE was_locked_by_user = true
GROUP BY game_date::date
ORDER BY game_date::date DESC
LIMIT 20;

-- 5. SPECIFIC PICKS (View actual picks)
SELECT 
  id,
  game_date,
  sport,
  home_team,
  away_team,
  pick,
  actual_outcome
FROM ai_suggestions
WHERE was_locked_by_user = true
ORDER BY game_date DESC
LIMIT 20;
