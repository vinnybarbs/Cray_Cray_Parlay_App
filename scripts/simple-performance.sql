-- ============================================================================
-- SIMPLE PERFORMANCE QUERIES (Guaranteed to work)
-- ============================================================================

-- 1. OVERALL WIN RATE (User's locked picks only)
SELECT 
  'My Picks' as category,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as wins,
  COUNT(*) FILTER (WHERE actual_outcome = 'lost') as losses,
  COUNT(*) FILTER (WHERE actual_outcome = 'push') as pushes,
  COUNT(*) FILTER (WHERE actual_outcome = 'pending') as pending
FROM ai_suggestions
WHERE was_locked_by_user = true;

-- 2. WIN RATE PERCENTAGE
SELECT 
  CASE 
    WHEN COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost')) > 0 
    THEN ROUND(
      COUNT(*) FILTER (WHERE actual_outcome = 'won')::numeric * 100.0 / 
      COUNT(*) FILTER (WHERE actual_outcome IN ('won', 'lost'))::numeric,
      1
    )
    ELSE NULL
  END as win_rate_percent
FROM ai_suggestions
WHERE was_locked_by_user = true
  AND actual_outcome IN ('won', 'lost');

-- 3. PARLAY RESULTS
SELECT 
  status,
  final_outcome,
  COUNT(*) as count
FROM parlays
GROUP BY status, final_outcome
ORDER BY status, final_outcome;

-- 4. BREAKDOWN BY BET TYPE
SELECT 
  bet_type,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as wins,
  COUNT(*) FILTER (WHERE actual_outcome = 'lost') as losses
FROM ai_suggestions
WHERE was_locked_by_user = true
  AND actual_outcome IN ('won', 'lost')
GROUP BY bet_type
ORDER BY total DESC;

-- 5. BREAKDOWN BY SPORT
SELECT 
  sport,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE actual_outcome = 'won') as wins,
  COUNT(*) FILTER (WHERE actual_outcome = 'lost') as losses
FROM ai_suggestions
WHERE was_locked_by_user = true
  AND actual_outcome IN ('won', 'lost')
GROUP BY sport
ORDER BY total DESC;
