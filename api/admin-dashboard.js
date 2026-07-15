const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../shared/logger');

// Admin access = a signed-in Supabase user whose email is on the allowlist.
// The old scheme (shared secret in the query string, defaulting to admin123,
// hardcoded in the client bundle) was flagged by the product audit — anyone
// reading the JS source could open the dashboard.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'vincemorello12@gmail.com')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// Verify the caller's Supabase JWT and check the allowlist. Returns the user
// on success, or null after writing the error response.
async function requireAdmin(req, res, supabase) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized', message: 'Sign in required' });
    return null;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid session' });
    return null;
  }
  const email = (data.user.email || '').toLowerCase();
  if (!ADMIN_EMAILS.includes(email)) {
    logger.warn('Non-admin attempted admin dashboard', { email });
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return data.user;
}

async function safeQuery(fn) {
  try {
    return await fn();
  } catch (err) {
    logger.warn('Admin dashboard query failed', { error: err.message });
    return null;
  }
}

async function getAdminDashboard(req, res) {
  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const adminUser = await requireAdmin(req, res, supabase);
  if (!adminUser) return;

  try {
    // --- 1. Cron Health: from pg_cron's own run details (ALL jobs) ---
    const cronHealthResult = await safeQuery(async () => {
      const { data, error } = await supabase.rpc('get_cron_health');
      if (error) {
        // Fallback: try direct SQL via cron_job_logs
        const { data: fallback } = await supabase
          .from('cron_job_logs')
          .select('job_name, status, details, created_at')
          .order('created_at', { ascending: false })
          .limit(20);
        return fallback || [];
      }
      return data || [];
    });

    // --- 2. Recent Errors: failed cron jobs, last 10 ---
    const recentErrorsResult = await safeQuery(async () => {
      const { data, error } = await supabase.rpc('get_cron_errors');
      if (error) {
        const { data: fallback } = await supabase
          .from('cron_job_logs')
          .select('job_name, status, details, created_at')
          .eq('status', 'failed')
          .order('created_at', { ascending: false })
          .limit(10);
        return fallback || [];
      }
      return data || [];
    });

    // --- 3. Model Accuracy: single MV read, slice by dimension ---
    const period = ['all', 'last_30d', 'last_7d'].includes(req.query.period)
      ? req.query.period
      : 'all';

    const modelAccuracyResult = await safeQuery(async () => {
      // Graded-era public record only (May 10 2026 onward, actionable tiers,
      // no soccer v1). The full-history mv_model_accuracy stays reserved for
      // calibration and the weekly review — it no longer appears on any
      // dashboard, admin included.
      const { data, error } = await supabase
        .from('mv_public_record')
        .select('*')
        .eq('period_bucket', period);
      if (error) throw error;

      // ROI intentionally dropped from response. The MV still computes it in
      // roi_units / roi_pct / settled_with_odds columns, but single-leg ROI
      // isn't a useful metric for a parlay-focused product — per-leg hit rate
      // is the north-star signal. See memory/project_performance_page_direction.md.
      const keyByValue = (rows) => {
        const out = {};
        for (const r of rows) {
          out[r.dimension_value] = {
            won: r.won || 0,
            lost: r.lost || 0,
            push: r.push || 0,
            pending: r.pending || 0,
            total: r.total || 0,
          };
        }
        return out;
      };

      const overallRow = data.find(r => r.dimension_type === 'overall');
      const overall = overallRow ? {
        won: overallRow.won || 0,
        lost: overallRow.lost || 0,
        push: overallRow.push || 0,
        pending: overallRow.pending || 0,
        total: overallRow.total || 0,
      } : { won: 0, lost: 0, push: 0, pending: 0, total: 0 };

      return {
        overall,
        bySport:   keyByValue(data.filter(r => r.dimension_type === 'sport')),
        byBetType: keyByValue(data.filter(r => r.dimension_type === 'bet_type')),
        byTier:    keyByValue(data.filter(r => r.dimension_type === 'tier')),
        period,
      };
    });

    // --- 4. Recent Picks: last 40 from ai_suggestions ---
    const recentPicksResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('ai_suggestions')
        .select('id, session_id, sport, home_team, away_team, game_date, bet_type, pick, odds, edge_pp, tier, actual_outcome, created_at, last_revised_at, generate_mode')
        .like('session_id', 'auto_digest%')
        .not('tier', 'is', null)
        .order('created_at', { ascending: false })
        .limit(40);
      if (error) throw error;
      return data || [];
    });

    // --- 4b. Intel feed: everything the research agent has filed ---
    const intelResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('agent_intel')
        .select('kind, team, payload, run_id, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    });

    // --- 4c. Pipeline runs: raw scrollable cron log ---
    const recentRunsResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('cron_job_logs')
        .select('job_name, status, details, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    });

    // --- 4d. Recent analyses: what the pick engine wrote, version by version ---
    const recentAnalysesResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('game_analysis')
        .select('game_key, sport, home_team, away_team, game_date, analysis_version, recommended_pick, edge_score, what_changed, analysis_snippet, model_used, prompt_tokens, completion_tokens, generated_at, stale')
        .order('generated_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    });

    // --- 4e. Machine parlays with the honest math ---
    const houseParlaysResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('house_parlays')
        .select('parlay_date, legs_count, legs, combined_odds, combined_edge_pp, model_win_prob, fair_win_prob, ev_pct, status, created_at, settled_at')
        .order('parlay_date', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    });

    // --- 5. Upcoming game inspector: every cell the tile is built from ---
    const upcomingAnalysesResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('game_analysis')
        .select('game_key, sport, home_team, away_team, game_date, analysis_version, stale, expires_at, generated_at, model_used, prompt_tokens, completion_tokens, recommended_pick, recommended_side, recommended_odds, edge_score, spread, total, moneyline_home, moneyline_away, home_record, away_record, home_ranking, away_ranking, calc_home_prob, calc_away_prob, implied_home_prob, implied_away_prob, calc_edge, calc_edge_side, edges, edges_raw, edge_factors, key_factors, analysis_snippet, what_changed, news_context, injury_context')
        .gt('game_date', new Date().toISOString())
        .order('game_date', { ascending: true })
        .limit(30);
      if (error) throw error;
      return data || [];
    });

    // --- 6. Data Freshness: count + max timestamp for key tables ---
    const tables = ['news_cache', 'news_articles', 'odds_cache', 'game_results', 'game_analysis'];
    const freshnessResults = {};

    await Promise.all(tables.map(async (table) => {
      const result = await safeQuery(async () => {
        // Get count
        const { count, error: countError } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });

        // Try common timestamp column names
        const timestampCols = ['generated_at', 'created_at', 'updated_at', 'last_updated', 'fetched_at', 'analyzed_at', 'published_at'];
        let maxTimestamp = null;

        for (const col of timestampCols) {
          const { data, error } = await supabase
            .from(table)
            .select(col)
            .order(col, { ascending: false })
            .limit(1);
          if (!error && data && data.length > 0 && data[0][col]) {
            maxTimestamp = data[0][col];
            break;
          }
        }

        return {
          table,
          count: countError ? null : count,
          maxTimestamp
        };
      });
      freshnessResults[table] = result || { table, count: null, maxTimestamp: null };
    }));

    // Build response
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      cronHealth: cronHealthResult || [],
      recentErrors: recentErrorsResult || [],
      modelAccuracy: modelAccuracyResult || {
        overall: { won: 0, lost: 0, push: 0, pending: 0, total: 0 },
        bySport: {},
        byBetType: {},
        byMode: {},
        edgeCalibration: [],
        edgeBuckets: [],
        chatConfidenceCalibration: [],
        period: 'all',
      },
      recentPicks: recentPicksResult || [],
      intel: intelResult || [],
      recentRuns: recentRunsResult || [],
      recentAnalyses: recentAnalysesResult || [],
      houseParlays: houseParlaysResult || [],
      upcomingAnalyses: upcomingAnalysesResult || [],
      dataFreshness: freshnessResults,
    });

  } catch (err) {
    logger.error('Admin dashboard error', { error: err.message });
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}

module.exports = { getAdminDashboard };
