const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../shared/logger');

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin123';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
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
  if (req.query.secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

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

    // --- 3. Model Accuracy: aggregate from ai_suggestions ---
    const overallAccuracyResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('ai_suggestions')
        .select('actual_outcome');
      if (error) throw error;
      const counts = { won: 0, lost: 0, push: 0, pending: 0, total: 0 };
      for (const row of data || []) {
        const outcome = row.actual_outcome || 'pending';
        counts[outcome] = (counts[outcome] || 0) + 1;
        counts.total++;
      }
      return counts;
    });

    const sportBreakdownResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('ai_suggestions')
        .select('sport, actual_outcome');
      if (error) throw error;
      const breakdown = {};
      for (const row of data || []) {
        const sport = row.sport || 'unknown';
        const outcome = row.actual_outcome || 'pending';
        if (!breakdown[sport]) breakdown[sport] = { won: 0, lost: 0, push: 0, pending: 0 };
        breakdown[sport][outcome] = (breakdown[sport][outcome] || 0) + 1;
      }
      return breakdown;
    });

    const betTypeBreakdownResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('ai_suggestions')
        .select('bet_type, actual_outcome');
      if (error) throw error;
      const breakdown = {};
      for (const row of data || []) {
        const betType = row.bet_type || 'unknown';
        const outcome = row.actual_outcome || 'pending';
        if (!breakdown[betType]) breakdown[betType] = { won: 0, lost: 0, push: 0, pending: 0 };
        breakdown[betType][outcome] = (breakdown[betType][outcome] || 0) + 1;
      }
      return breakdown;
    });

    // --- 4. Recent Picks: last 15 from ai_suggestions ---
    const recentPicksResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('ai_suggestions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(15);
      if (error) throw error;
      return data || [];
    });

    // --- 5. Settlement Status: parlays count by status ---
    const parlayStatusResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('parlays')
        .select('status');
      if (error) throw error;
      const counts = {};
      for (const row of data || []) {
        const status = row.status || 'unknown';
        counts[status] = (counts[status] || 0) + 1;
      }
      return counts;
    });

    const parlayLegsResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('parlay_legs')
        .select('outcome');
      if (error) throw error;
      const counts = {};
      for (const row of data || []) {
        const outcome = row.outcome || 'pending';
        counts[outcome] = (counts[outcome] || 0) + 1;
      }
      return counts;
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
        const timestampCols = ['created_at', 'updated_at', 'last_updated', 'fetched_at', 'analyzed_at'];
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

    // Confidence calibration — win rate by confidence level
    const confidenceCalibrationResult = await safeQuery(async () => {
      const { data } = await supabase
        .from('ai_suggestions')
        .select('confidence, actual_outcome')
        .not('confidence', 'is', null)
        .in('actual_outcome', ['won', 'lost']);
      if (!data) return [];
      const buckets = {};
      data.forEach(row => {
        const c = row.confidence;
        if (!buckets[c]) buckets[c] = { confidence: c, won: 0, lost: 0 };
        if (row.actual_outcome === 'won') buckets[c].won++;
        else buckets[c].lost++;
      });
      return Object.values(buckets)
        .map(b => ({ ...b, total: b.won + b.lost, winPct: Math.round(100 * b.won / (b.won + b.lost)) }))
        .sort((a, b) => a.confidence - b.confidence);
    });

    // Build response
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      cronHealth: cronHealthResult || [],
      recentErrors: recentErrorsResult || [],
      modelAccuracy: {
        overall: overallAccuracyResult || { won: 0, lost: 0, push: 0, pending: 0, total: 0 },
        bySport: sportBreakdownResult || {},
        byBetType: betTypeBreakdownResult || {}
      },
      recentPicks: recentPicksResult || [],
      settlementStatus: {
        parlaysByStatus: parlayStatusResult || {},
        legsByOutcome: parlayLegsResult || {}
      },
      dataFreshness: freshnessResults,
      confidenceCalibration: confidenceCalibrationResult || []
    });

  } catch (err) {
    logger.error('Admin dashboard error', { error: err.message });
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}

module.exports = { getAdminDashboard };
