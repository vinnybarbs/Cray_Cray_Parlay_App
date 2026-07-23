// Read-only analytics bundle for the weekly model-performance review routine
// (a scheduled Claude agent on Vince's Max plan). Auth: a dedicated secret in
// app_config ('report_secret'), deliberately NOT CRON_SECRET, which can
// trigger expensive jobs. This endpoint only reads aggregates.

const { supabase } = require('../lib/middleware/supabaseAuth.js');

module.exports = async function reviewBundle(req, res) {
  try {
    // Two accepted read-only secrets: the original report_secret (weekly
    // review) and report_secret_2 (daily routine, embedded in its task
    // prompt so scheduled runs need no database connector).
    const { data: cfgRows } = await supabase
      .from('app_config').select('key, value').in('key', ['report_secret', 'report_secret_2']);
    const accepted = new Set((cfgRows || []).map(r => r.value).filter(Boolean));
    const provided = req.headers['x-report-secret'] || req.query.secret;
    if (accepted.size === 0 || !provided || !accepted.has(provided)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const [calibration, mv, clv, pendings, intel] = await Promise.all([
      supabase.from('edge_calibration').select('*').order('key'),
      supabase.from('mv_model_accuracy').select('*'),
      supabase.from('v_pick_clv')
        .select('sport, tier, actual_outcome, clv_pp, game_date')
        .gte('game_date', new Date(Date.now() - 7 * 86400e3).toISOString())
        .limit(500),
      supabase.from('ai_suggestions')
        .select('sport', { count: 'exact', head: true })
        .eq('actual_outcome', 'pending')
        .lt('game_date', new Date(Date.now() - 2 * 86400e3).toISOString()),
      supabase.from('cron_job_logs')
        .select('created_at, status, details')
        .eq('job_name', 'data_integrity_sweep')
        .order('created_at', { ascending: false })
        .limit(14),
    ]);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      generated_at: new Date().toISOString(),
      edge_calibration: calibration.data ?? [],
      model_accuracy: mv.data ?? [],
      clv_last_7d: clv.data ?? [],
      stale_pending_count: pendings.count ?? null,
      integrity_sweeps: intel.data ?? [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
