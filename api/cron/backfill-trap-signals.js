/**
 * One-shot backfill: lure signals for historical trap rows.
 *
 * The 2026-08-06 calibration review found trap_signals populated only on
 * traps published after the detector redesign (Aug 3). The 30-plus older
 * trap rows (May 12 to Jul 10, published back when the trap was the
 * game's read) carry no signals, which left every lure signal judged on a
 * 17 pick sample.
 *
 * This endpoint re-runs today's detector against the inputs stored at
 * analysis time in game_analysis (edges, edge_factors, prices), so the
 * signal attribution is historical, not reconstructed from current data.
 * Rows where today's detector would NOT have fired keep trap_signals
 * null on purpose: they were called under the old mirror-of-pick logic
 * and including them in lure-signal calibration would poison it. The
 * date (pre Aug 3) plus a fired/not-fired count in the log is the
 * provenance trail.
 *
 * Idempotent: only touches rows with trap_signals IS NULL, so re-running
 * after the first pass is a no-op. Not scheduled in pg_cron, trigger
 * manually via /cron/backfill-trap-signals?secret=...
 */

const { createClient } = require('@supabase/supabase-js');
const trapDetector = require('../../lib/services/trap-detector');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function parseMaybeJson(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

async function runBackfill() {
  const summary = { candidates: 0, updated: 0, no_analysis: 0, detector_silent: 0, errors: [] };

  const { data: traps, error } = await supabase
    .from('ai_suggestions')
    .select('id, sport, home_team, away_team, game_date, edge_pp')
    .eq('tier', 'Trap')
    .like('session_id', 'auto_digest%')
    .is('trap_signals', null);
  if (error) throw error;

  summary.candidates = (traps || []).length;

  for (const t of traps || []) {
    try {
      // A trap row stores a calendar date while game_analysis stores a
      // timestamp, and a 7pm MT first pitch lands past midnight UTC. The
      // window reaches 12h each side of the calendar day so the same game
      // matches from either side of the boundary.
      const day = new Date(`${String(t.game_date).slice(0, 10)}T00:00:00Z`).getTime();
      const { data: gaRows } = await supabase
        .from('game_analysis')
        .select('edges, edge_factors, moneyline_home, moneyline_away, spread, total')
        .eq('home_team', t.home_team)
        .eq('away_team', t.away_team)
        .gte('game_date', new Date(day - 12 * 3600 * 1000).toISOString())
        .lte('game_date', new Date(day + 36 * 3600 * 1000).toISOString())
        .limit(1);
      const ga = gaRows?.[0];
      if (!ga || !ga.edges) { summary.no_analysis++; continue; }

      const edgeData = { edges: parseMaybeJson(ga.edges), factors: parseMaybeJson(ga.edge_factors) || {} };
      const oddsCtx = { ml_home: ga.moneyline_home, ml_away: ga.moneyline_away, spread: ga.spread, total: ga.total };
      const calls = trapDetector.detectTraps({
        edgeData, oddsCtx,
        game: { home_team: t.home_team, away_team: t.away_team },
        sport: t.sport,
      });
      if (calls.length === 0) { summary.detector_silent++; continue; }

      // Prefer the call matching the stored edge (within 3pp), else strongest.
      const match = calls.find(c => t.edge_pp != null && Math.abs(c.edge_pp - Number(t.edge_pp)) <= 3) || calls[0];

      const { error: upErr } = await supabase
        .from('ai_suggestions')
        .update({ trap_signals: match.signals, lure_score: match.lure_score })
        .eq('id', t.id);
      if (upErr) throw upErr;
      summary.updated++;
    } catch (e) {
      summary.errors.push(`${t.away_team} @ ${t.home_team} ${String(t.game_date).slice(0, 10)}: ${e.message}`);
    }
  }

  try {
    await supabase.from('cron_job_logs').insert({
      job_name: 'backfill-trap-signals',
      status: summary.errors.length ? 'partial' : 'completed',
      details: JSON.stringify({ ...summary, errors: summary.errors.slice(0, 5) }),
    });
  } catch { /* best-effort */ }

  return summary;
}

async function backfillTrapSignals(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const summary = await runBackfill();
    res.json({ success: true, ...summary });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

module.exports = backfillTrapSignals;
