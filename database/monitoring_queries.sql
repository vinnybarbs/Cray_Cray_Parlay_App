-- ============================================================================
-- CRAY CRAY PARLAY APP - DATABASE MONITORING QUERIES
-- ============================================================================
-- Run these in Supabase SQL Editor to monitor your app's data
-- https://supabase.com/dashboard → Your Project → SQL Editor
-- ============================================================================

-- ============================================================================
-- 1. QUICK OVERVIEW - Run this first to see everything at a glance
-- ============================================================================

SELECT 
  'users' as table_name, 
  COUNT(*) as count,
  MAX(created_at) as last_activity
FROM auth.users
UNION ALL
SELECT 
  'parlays', 
  COUNT(*), 
  MAX(created_at)
FROM parlays
UNION ALL
SELECT 
  'parlay_legs', 
  COUNT(*), 
  MAX(created_at)
FROM parlay_legs
UNION ALL
SELECT 
  'odds_cache', 
  COUNT(*), 
  MAX(fetched_at)
FROM odds_cache
ORDER BY table_name;

-- ============================================================================
-- 2. ODDS CACHE STATUS - Check if cache is working
-- ============================================================================

-- Summary by sport and bookmaker
SELECT 
  sport,
  bookmaker,
  market_type,
  COUNT(*) as odds_count,
  MAX(fetched_at) as last_updated,
  ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(fetched_at)))/3600, 1) as hours_old,
  CASE 
    WHEN NOW() - MAX(fetched_at) > INTERVAL '2 hours' THEN '⚠️ STALE'
    WHEN NOW() - MAX(fetched_at) > INTERVAL '1 hour' THEN '⏰ AGING'
    ELSE '✅ FRESH'
  END as status
FROM odds_cache
GROUP BY sport, bookmaker, market_type
ORDER BY sport, bookmaker, market_type;

-- Total odds cached per sport
SELECT 
  sport,
  COUNT(*) as total_odds,
  COUNT(DISTINCT game_id) as unique_games,
  COUNT(DISTINCT bookmaker) as bookmakers,
  MIN(fetched_at) as oldest,
  MAX(fetched_at) as newest
FROM odds_cache
GROUP BY sport
ORDER BY total_odds DESC;

-- Check cache freshness (should be refreshed hourly)
SELECT 
  sport,
  MAX(fetched_at) as last_refresh,
  NOW() - MAX(fetched_at) as time_since_refresh,
  CASE 
    WHEN NOW() - MAX(fetched_at) > INTERVAL '2 hours' THEN '❌ NEEDS REFRESH'
    WHEN NOW() - MAX(fetched_at) > INTERVAL '1 hour' THEN '⚠️ DUE SOON'
    ELSE '✅ UP TO DATE'
  END as cache_status
FROM odds_cache
GROUP BY sport
ORDER BY last_refresh DESC;

-- ============================================================================
-- 3. USER ACTIVITY - See who's using the app
-- ============================================================================

-- All users with their activity
SELECT 
  u.id,
  u.email,
  u.created_at as signed_up,
  u.last_sign_in_at as last_login,
  COUNT(p.id) as total_parlays,
  MAX(p.created_at) as last_parlay
FROM auth.users u
LEFT JOIN parlays p ON u.id = p.user_id
GROUP BY u.id, u.email, u.created_at, u.last_sign_in_at
ORDER BY u.created_at DESC;

-- User stats summary
SELECT 
  u.email,
  COUNT(p.id) as total_parlays,
  SUM(CASE WHEN p.final_outcome = 'win' THEN 1 ELSE 0 END) as wins,
  SUM(CASE WHEN p.final_outcome = 'loss' THEN 1 ELSE 0 END) as losses,
  SUM(CASE WHEN p.final_outcome = 'push' THEN 1 ELSE 0 END) as pushes,
  SUM(CASE WHEN p.status = 'pending' THEN 1 ELSE 0 END) as pending,
  ROUND(
    CASE 
      WHEN COUNT(p.id) > 0 THEN 
        (SUM(CASE WHEN p.final_outcome = 'win' THEN 1 ELSE 0 END)::numeric / 
         NULLIF(SUM(CASE WHEN p.final_outcome IN ('win', 'loss') THEN 1 ELSE 0 END), 0) * 100)
      ELSE 0 
    END, 
    1
  ) as win_rate_pct,
  COALESCE(SUM(p.profit_loss), 0) as total_profit_loss
FROM auth.users u
LEFT JOIN parlays p ON u.id = p.user_id
GROUP BY u.id, u.email
ORDER BY total_parlays DESC;

-- ============================================================================
-- 4. PARLAY HISTORY - Recent parlays and their details
-- ============================================================================

-- Last 20 parlays created
SELECT 
  p.id,
  p.created_at,
  u.email as user_email,
  p.total_legs,
  p.combined_odds,
  p.potential_payout,
  p.risk_level,
  p.sportsbook,
  p.status,
  p.final_outcome,
  p.profit_loss,
  p.is_lock_bet
FROM parlays p
JOIN auth.users u ON p.user_id = u.id
ORDER BY p.created_at DESC
LIMIT 20;

-- Parlays by status
SELECT 
  status,
  COUNT(*) as count,
  AVG(total_legs) as avg_legs,
  AVG(potential_payout) as avg_payout
FROM parlays
GROUP BY status
ORDER BY count DESC;

-- Parlays by risk level
SELECT 
  risk_level,
  COUNT(*) as count,
  AVG(total_legs) as avg_legs,
  AVG(potential_payout) as avg_payout,
  SUM(CASE WHEN final_outcome = 'win' THEN 1 ELSE 0 END) as wins,
  SUM(CASE WHEN final_outcome = 'loss' THEN 1 ELSE 0 END) as losses
FROM parlays
GROUP BY risk_level
ORDER BY count DESC;

-- ============================================================================
-- 5. PARLAY LEGS - Individual picks analysis
-- ============================================================================

-- Recent picks with details
SELECT 
  pl.parlay_id,
  pl.leg_number,
  pl.game_date,
  pl.sport,
  pl.away_team || ' @ ' || pl.home_team as matchup,
  pl.bet_type,
  pl.bet_details->>'pick' as pick,
  pl.bet_details->>'point' as point,
  pl.odds,
  pl.confidence,
  LEFT(pl.reasoning, 100) || '...' as reasoning_preview
FROM parlay_legs pl
ORDER BY pl.created_at DESC
LIMIT 50;

-- Most popular sports
SELECT 
  sport,
  COUNT(*) as picks_count,
  AVG(confidence) as avg_confidence,
  COUNT(DISTINCT parlay_id) as parlays_count
FROM parlay_legs
GROUP BY sport
ORDER BY picks_count DESC;

-- Most popular bet types
SELECT 
  bet_type,
  COUNT(*) as count,
  AVG(confidence) as avg_confidence
FROM parlay_legs
GROUP BY bet_type
ORDER BY count DESC;

-- Highest confidence picks
SELECT 
  pl.sport,
  pl.away_team || ' @ ' || pl.home_team as matchup,
  pl.bet_details->>'pick' as pick,
  pl.odds,
  pl.confidence,
  pl.reasoning
FROM parlay_legs pl
WHERE pl.confidence >= 8
ORDER BY pl.confidence DESC, pl.created_at DESC
LIMIT 20;

-- ============================================================================
-- 6. PERFORMANCE METRICS - Win rates and profitability
-- ============================================================================

-- Overall app performance
SELECT 
  COUNT(*) as total_parlays,
  SUM(CASE WHEN final_outcome = 'win' THEN 1 ELSE 0 END) as wins,
  SUM(CASE WHEN final_outcome = 'loss' THEN 1 ELSE 0 END) as losses,
  SUM(CASE WHEN final_outcome = 'push' THEN 1 ELSE 0 END) as pushes,
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
  ROUND(
    (SUM(CASE WHEN final_outcome = 'win' THEN 1 ELSE 0 END)::numeric / 
     NULLIF(SUM(CASE WHEN final_outcome IN ('win', 'loss') THEN 1 ELSE 0 END), 0) * 100),
    1
  ) as win_rate_pct,
  SUM(profit_loss) as total_profit_loss,
  AVG(total_legs) as avg_legs_per_parlay,
  AVG(potential_payout) as avg_payout
FROM parlays;

-- Performance by number of legs
SELECT 
  total_legs,
  COUNT(*) as count,
  SUM(CASE WHEN final_outcome = 'win' THEN 1 ELSE 0 END) as wins,
  ROUND(
    (SUM(CASE WHEN final_outcome = 'win' THEN 1 ELSE 0 END)::numeric / 
     NULLIF(SUM(CASE WHEN final_outcome IN ('win', 'loss') THEN 1 ELSE 0 END), 0) * 100),
    1
  ) as win_rate_pct,
  AVG(potential_payout) as avg_payout
FROM parlays
WHERE final_outcome IN ('win', 'loss')
GROUP BY total_legs
ORDER BY total_legs;

-- Daily activity (last 30 days)
SELECT 
  DATE(created_at) as date,
  COUNT(*) as parlays_created,
  COUNT(DISTINCT user_id) as unique_users,
  AVG(total_legs) as avg_legs,
  SUM(CASE WHEN final_outcome = 'win' THEN 1 ELSE 0 END) as wins
FROM parlays
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- ============================================================================
-- 7. SPECIFIC PARLAY DETAILS - Deep dive into a single parlay
-- ============================================================================

-- Replace 'PARLAY_ID_HERE' with actual parlay ID
SELECT 
  p.id,
  p.created_at,
  u.email as user,
  p.total_legs,
  p.combined_odds,
  p.potential_payout,
  p.risk_level,
  p.sportsbook,
  p.status,
  p.final_outcome,
  p.profit_loss
FROM parlays p
JOIN auth.users u ON p.user_id = u.id
WHERE p.id = 'PARLAY_ID_HERE';

-- Get all legs for a specific parlay
SELECT 
  leg_number,
  game_date,
  sport,
  away_team || ' @ ' || home_team as matchup,
  bet_type,
  bet_details->>'pick' as pick,
  bet_details->>'point' as point,
  bet_details->>'spread' as spread,
  odds,
  confidence,
  reasoning
FROM parlay_legs
WHERE parlay_id = 'PARLAY_ID_HERE'
ORDER BY leg_number;

-- ============================================================================
-- 8. DATA QUALITY CHECKS - Find issues
-- ============================================================================

-- Parlays with missing legs
SELECT 
  p.id,
  p.total_legs as expected_legs,
  COUNT(pl.id) as actual_legs,
  p.total_legs - COUNT(pl.id) as missing_legs
FROM parlays p
LEFT JOIN parlay_legs pl ON p.id = pl.parlay_id
GROUP BY p.id, p.total_legs
HAVING p.total_legs != COUNT(pl.id)
ORDER BY missing_legs DESC;

-- Stale pending parlays (older than 7 days)
SELECT 
  p.id,
  p.created_at,
  u.email,
  p.total_legs,
  NOW() - p.created_at as age
FROM parlays p
JOIN auth.users u ON p.user_id = u.id
WHERE p.status = 'pending'
  AND p.created_at < NOW() - INTERVAL '7 days'
ORDER BY p.created_at;

-- Orphaned parlay legs (legs without parent parlay)
SELECT 
  pl.id,
  pl.parlay_id,
  pl.sport,
  pl.created_at
FROM parlay_legs pl
LEFT JOIN parlays p ON pl.parlay_id = p.id
WHERE p.id IS NULL;

-- ============================================================================
-- 9. CACHE MAINTENANCE - Clean up old data
-- ============================================================================

-- Find old odds that should be deleted (older than 24 hours)
SELECT 
  sport,
  COUNT(*) as old_odds_count
FROM odds_cache
WHERE fetched_at < NOW() - INTERVAL '24 hours'
GROUP BY sport;

-- DELETE old odds (uncomment to run)
-- DELETE FROM odds_cache 
-- WHERE fetched_at < NOW() - INTERVAL '24 hours';

-- ============================================================================
-- 10. EXPORT DATA - Get data for analysis
-- ============================================================================

-- Export all parlays with user info (CSV friendly)
SELECT 
  p.id,
  u.email,
  p.created_at,
  p.total_legs,
  p.combined_odds,
  p.potential_payout,
  p.risk_level,
  p.sportsbook,
  p.status,
  p.final_outcome,
  p.profit_loss,
  p.is_lock_bet
FROM parlays p
JOIN auth.users u ON p.user_id = u.id
ORDER BY p.created_at DESC;

-- Export all picks (CSV friendly)
SELECT 
  pl.parlay_id,
  pl.leg_number,
  pl.game_date,
  pl.sport,
  pl.home_team,
  pl.away_team,
  pl.bet_type,
  pl.bet_details->>'pick' as pick,
  pl.odds,
  pl.confidence
FROM parlay_legs pl
ORDER BY pl.parlay_id, pl.leg_number;

-- ============================================================================
-- END OF MONITORING QUERIES
-- ============================================================================
-- Save this file and run queries as needed in Supabase SQL Editor
-- For real-time monitoring, consider setting up a dashboard tool
-- ============================================================================
