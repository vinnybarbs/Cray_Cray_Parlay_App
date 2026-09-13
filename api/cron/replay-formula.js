/**
 * CRON (on demand): the counterfactual replay harness.
 *
 * POST /cron/replay-formula?secret=...&sport=MLB&days=30&formulas=july,current
 * POST /cron/replay-formula?secret=...&sport=MLB&days=30&variants=base:current;chalk5:current:chalk_penalty_pp=5
 * POST /cron/replay-formula?secret=...&sport=MLB&days=30&variants=...&file=1   (Sunday sweep: file candidates)
 *
 * Runs lib/replay/replay-formula.js on Railway, where the database is
 * reachable, writes one row per pick to replay_picks and one summary row
 * to cron_job_logs (job_name replay-formula). Read only apart from those
 * two tables: it never touches ai_suggestions or the record.
 */

'use strict';

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { runReplay, parseVariants } = require('../../lib/replay/replay-formula.js');

async function replayFormula(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  const sport = String(req.query.sport || 'MLB');
  const days = Math.min(120, Math.max(1, parseInt(req.query.days, 10) || 30));
  const formulas = String(req.query.formulas || 'july,current').split(',').map(s => s.trim()).filter(f => ['july', 'current'].includes(f));
  const runId = req.query.run_id ? String(req.query.run_id).slice(0, 80) : null;
  // variants=name:kind[:dial=value,...];... runs a dial sweep in one pass.
  const variants = req.query.variants ? parseVariants(String(req.query.variants)) : null;
  const label = variants && variants.length ? variants.map(v => v.name).join(', ') : formulas.join(' and ');
  res.status(202).json({ status: 'accepted', message: `Replay started: ${sport}, ${days} days, ${label}` });
  (async () => {
    try {
      const summary = await runReplay(supabase, { sport, days, formulas, variants, runId, log: (m) => console.warn(m) });
      // file=1 (the Sunday sweep): every variant is scored against base
      // with the three test counterfactual in SQL and the ones that pass
      // land in build_queue for the owner's Monday yes or no.
      if (String(req.query.file || '') === '1' && summary.run_id) {
        try {
          const { data, error } = await supabase.rpc('file_replay_candidates', { p_run_id: summary.run_id });
          summary.candidates_filed = error ? `error: ${error.message}` : data;
        } catch (e) { summary.candidates_filed = `error: ${e.message}`; }
      }
      await supabase.from('cron_job_logs').insert({ job_name: 'replay-formula', status: summary.write_error ? 'partial' : 'completed', details: JSON.stringify(summary) });
    } catch (err) {
      console.error('replay-formula error:', err.message);
      try { await supabase.from('cron_job_logs').insert({ job_name: 'replay-formula', status: 'failed', details: JSON.stringify({ sport, days, formulas, error: err.message }) }); } catch { /* best effort */ }
    }
  })();
}

module.exports = replayFormula;
