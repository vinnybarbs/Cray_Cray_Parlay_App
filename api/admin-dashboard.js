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

    // --- 3. Model Accuracy: single MV read, slice by dimension ---
    const period = ['all', 'last_30d', 'last_7d'].includes(req.query.period)
      ? req.query.period
      : 'all';

    const modelAccuracyResult = await safeQuery(async () => {
      const { data, error } = await supabase
        .from('mv_model_accuracy')
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
        byMode:    keyByValue(data.filter(r => r.dimension_type === 'generate_mode')),
        edgeCalibration:           data.filter(r => r.dimension_type === 'edge_integer').sort((a, b) => Number(a.dimension_value) - Number(b.dimension_value)),
        edgeBuckets:               data.filter(r => r.dimension_type === 'edge_bucket'),
        chatConfidenceCalibration: data.filter(r => r.dimension_type === 'chat_confidence').sort((a, b) => Number(a.dimension_value) - Number(b.dimension_value)),
        period,
      };
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
      settlementStatus: {
        parlaysByStatus: parlayStatusResult || {},
        legsByOutcome: parlayLegsResult || {}
      },
      dataFreshness: freshnessResults,
    });

  } catch (err) {
    logger.error('Admin dashboard error', { error: err.message });
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}

module.exports = { getAdminDashboard };
