-- ============================================================================
-- AI MODEL vs USER PERFORMANCE ANALYSIS
-- Run these queries after migrating old parlays to see model vs user stats
-- ============================================================================

-- 1. MODEL PERFORMANCE (All AI Suggestions)
-- How accurate is the AI across all picks it generates?
SELECT 
  'AI Model Performance' as metric_type,
  COUNT(*) as total_suggestions,
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as wins,
  COUNT(*) FILTER (WHERE actual_outcome = 'lost') as losses,
  COUNT(*) FILTER (WHERE actual_outcome = 'push') as pushes,
  COUNT(*) FILTER (WHERE actual_outcome = 'pending') as pending,
  ROUND(
    COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 / 
    NULLIF(COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')), 0),
    1
  ) as win_rate_percent
FROM ai_suggestions
WHERE actual_outcome IN ('won', 'lost', 'push', 'pending');

-- 2. USER SELECTION PERFORMANCE (Picks Users Actually Locked)
-- How well do users pick from AI suggestions?
SELECT 
  'User Selection Performance' as metric_type,
  COUNT(*) as total_picks_locked,
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as wins,
  COUNT(*) FILTER (WHERE actual_outcome = 'lost') as losses,
  COUNT(*) FILTER (WHERE actual_outcome = 'push') as pushes,
  COUNT(*) FILTER (WHERE actual_outcome = 'pending') as pending,
  ROUND(
    COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 / 
    NULLIF(COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')), 0),
    1
  ) as win_rate_percent
FROM ai_suggestions
WHERE was_locked_by_user = true
  AND actual_outcome IN ('won', 'lost', 'push', 'pending');

-- 3. PARLAY PERFORMANCE (Complete Parlays)
-- How often do full parlays hit?
SELECT 
  'Parlay Performance' as metric_type,
  COUNT(*) as total_parlays,
  COUNT(*) FILTER (WHERE final_outcome = 'won') as wins,
  COUNT(*) FILTER (WHERE final_outcome = 'lost') as losses,
  COUNT(*) FILTER (WHERE final_outcome = 'push') as pushes,
  COUNT(*) FILTER (WHERE status = 'pending') as pending,
  ROUND(
    COUNT(*) FILTER (WHERE final_outcome = 'won') * 100.0 / 
    NULLIF(COUNT(*) FILTER (WHERE final_outcome IN ('won', 'lost')), 0),
    1
  ) as win_rate_percent,
  ROUND(AVG(total_legs), 1) as avg_legs_per_parlay
FROM parlays;

-- 4. PERFORMANCE BY BET TYPE
-- Which bet types are most accurate?
SELECT 
  bet_type,
  COUNT(*) as total_picks,
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as wins,
  COUNT(*) FILTER (WHERE actual_outcome = 'lost') as losses,
  ROUND(
    COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 / 
    NULLIF(COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')), 0),
    1
  ) as win_rate_percent
FROM ai_suggestions
WHERE was_locked_by_user = true
  AND actual_outcome IN ('won', 'lost')
GROUP BY bet_type
ORDER BY win_rate_percent DESC;

-- 5. PERFORMANCE BY SPORT
SELECT 
  sport,
  COUNT(*) as total_picks,
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as wins,
  COUNT(*) FILTER (WHERE actual_outcome = 'lost') as losses,
  ROUND(
    COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 / 
    NULLIF(COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')), 0),
    1
  ) as win_rate_percent
FROM ai_suggestions
WHERE was_locked_by_user = true
  AND actual_outcome IN ('won', 'lost')
GROUP BY sport
ORDER BY win_rate_percent DESC;

-- 6. CONFIDENCE CORRELATION
-- Does AI confidence predict success?
SELECT 
  CASE 
    WHEN confidence >= 8 THEN 'High (8-10)'
    WHEN confidence >= 6 THEN 'Medium (6-7)'
    ELSE 'Low (1-5)'
  END as confidence_tier,
  COUNT(*) as total_picks,
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as wins,
  ROUND(
    COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 / 
    NULLIF(COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')), 0),
    1
  ) as win_rate_percent
FROM ai_suggestions
WHERE was_locked_by_user = true
  AND actual_outcome IN ('won', 'lost')
GROUP BY confidence_tier
ORDER BY 
  CASE confidence_tier
    WHEN 'High (8-10)' THEN 1
    WHEN 'Medium (6-7)' THEN 2
    ELSE 3
  END;

-- 7. MODEL ACCURACY vs USER PICK RATE
-- Do users pick the AI's most confident picks?
SELECT 
  'Model All Suggestions' as category,
  ROUND(AVG(confidence), 1) as avg_confidence,
  COUNT(*) as total_picks,
  ROUND(
    COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 / 
    NULLIF(COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')), 0),
    1
  ) as win_rate_percent
FROM ai_suggestions
WHERE actual_outcome IN ('won', 'lost')

UNION ALL

SELECT 
  'User Locked Picks' as category,
  ROUND(AVG(confidence), 1) as avg_confidence,
  COUNT(*) as total_picks,
  ROUND(
    COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 / 
    NULLIF(COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')), 0),
    1
  ) as win_rate_percent
FROM ai_suggestions
WHERE was_locked_by_user = true
  AND actual_outcome IN ('won', 'lost');

-- 8. RECENT TRENDS (Last 30 Days)
SELECT 
  DATE_TRUNC('week', game_date) as week,
  COUNT(*) as total_picks,
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as wins,
  ROUND(
    COUNT(*) FILTER (WHERE actual_outcome = 'won') * 100.0 / 
    NULLIF(COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')), 0),
    1
  ) as win_rate_percent
FROM ai_suggestions
WHERE was_locked_by_user = true
  AND game_date >= NOW() - INTERVAL '30 days'
  AND actual_outcome IN ('won', 'lost')
GROUP BY week
ORDER BY week DESC;

-- 9. PROFIT/LOSS ANALYSIS
-- Assuming $100 flat bet per pick
SELECT 
  'Hypothetical P&L ($100/pick)' as metric,
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as winning_picks,
  COUNT(*) FILTER (WHERE actual_outcome = 'lost') as losing_picks,
  -- Calculate profit assuming American odds
  ROUND(
    SUM(
      CASE 
        WHEN actual_outcome = 'won' AND CAST(REPLACE(odds, '+', '') AS INTEGER) > 0 
          THEN 100.0 * (CAST(REPLACE(odds, '+', '') AS INTEGER) / 100.0)
        WHEN actual_outcome = 'won' 
          THEN 100.0 * (100.0 / ABS(CAST(odds AS INTEGER)))
        WHEN actual_outcome = 'lost' 
          THEN -100.0
        ELSE 0
      END
    ),
    2
  ) as total_profit_loss
FROM ai_suggestions
WHERE was_locked_by_user = true
  AND actual_outcome IN ('won', 'lost');

-- ============================================================================
-- SUMMARY VIEW: Create a combined performance report
-- ============================================================================
CREATE OR REPLACE VIEW performance_summary AS
WITH model_stats AS (
  SELECT 
    COUNT(*) as total_suggestions,
    COUNT(*) FILTER (WHERE actual_outcome = 'won') as model_wins,
    COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')) as model_decided
  FROM ai_suggestions
  WHERE actual_outcome IN ('won', 'lost')
),
user_stats AS (
  SELECT 
    COUNT(*) as total_locked,
    COUNT(*) FILTER (WHERE actual_outcome = 'won') as user_wins,
    COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')) as user_decided
  FROM ai_suggestions
  WHERE was_locked_by_user = true
    AND actual_outcome IN ('won', 'lost')
),
parlay_stats AS (
  SELECT 
    COUNT(*) as total_parlays,
    COUNT(*) FILTER (WHERE final_outcome = 'won') as parlay_wins,
    COUNT(*) FILTER (WHERE final_outcome IN ('won', 'lost')) as parlay_decided
  FROM parlays
  WHERE final_outcome IN ('won', 'lost')
)
SELECT 
  ROUND(m.model_wins * 100.0 / NULLIF(m.model_decided, 0), 1) as model_win_rate,
  ROUND(u.user_wins * 100.0 / NULLIF(u.user_decided, 0), 1) as user_pick_win_rate,
  ROUND(p.parlay_wins * 100.0 / NULLIF(p.parlay_decided, 0), 1) as parlay_win_rate,
  m.model_decided as model_total_picks,
  u.user_decided as user_total_picks,
  p.parlay_decided as total_parlays
FROM model_stats m, user_stats u, parlay_stats p;

-- Query the summary
SELECT * FROM performance_summary;
