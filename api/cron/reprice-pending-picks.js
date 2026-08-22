/**
 * CRON: Lock-time reprice for mid-band picks.
 *
 * The CLV data showed the 4-10pp band takes prices worse than the close
 * (avg CLV -0.58 to -1.04pp) while Sharp Takes beat it. The mechanism is
 * staleness: a pick priced in the afternoon can be underwater by first
 * pitch. This job re-checks every pending Play-tier moneyline pick in
 * the final 90 minutes before its game against the CURRENT market. If
 * the market has moved a full point of implied probability against the
 * picked side, the pick demotes to Lean. Tightening only, a pick never
 * promotes here.
 *
 * Endpoint: POST /cron/reprice-pending-picks?secret=...
 * Schedule: every 30 minutes (pg_cron, 20260810190000).
 */

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { withTierHistory, historyEntry } = require('../../lib/services/tier-history.js');

const WINDOW_MIN = 90;          // only picks starting within this window
const DEMOTE_DRIFT_PP = 1.0;    // implied-prob move against us that triggers demotion

function impliedPct(american) {
  const o = Number(american);
  if (!Number.isFinite(o) || o === 0) return null;
  return o > 0 ? 100 * 100 / (o + 100) : 100 * -o / (-o + 100);
}

async function currentPriceFor(row, pickTeam) {
  // Prefer the exact event the pick was priced from.
  let q = supabase
    .from('odds_cache')
    .select('outcomes, external_game_id, home_team, away_team, commence_time')
    .eq('market_type', 'h2h');
  if (row.odds_event_id) {
    q = q.eq('external_game_id', row.odds_event_id);
  } else {
    q = q.eq('home_team', row.home_team).eq('away_team', row.away_team);
  }
  const { data } = await q;
  const prices = [];
  for (const r of data || []) {
    if (!row.odds_event_id) {
      const dt = Math.abs(new Date(r.commence_time) - new Date(row.game_date));
      if (dt > 3 * 3600 * 1000) continue;
    }
    for (const o of r.outcomes || []) {
      if (o?.name === pickTeam && o?.price != null) prices.push(Number(o.price));
    }
  }
  if (!prices.length) return null;
  // Average implied across books, then back to a representative price.
  const avgImplied = prices.map(impliedPct).reduce((a, b) => a + b, 0) / prices.length;
  return { avgImplied };
}

async function runReprice() {
  const startTime = Date.now();
  const summary = { checked: 0, demoted: 0, no_market: 0, held: 0, errors: [] };
  try {
    const nowIso = new Date().toISOString();
    const horizon = new Date(Date.now() + WINDOW_MIN * 60 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from('ai_suggestions')
      .select('id, pick, odds, tier, tier_history, edge_pp, home_team, away_team, game_date, odds_event_id')
      .like('session_id', 'auto_digest_2%')
      .in('tier', ['Play', 'Strong Play'])
      .eq('actual_outcome', 'pending')
      .is('voided_at', null)
      .ilike('bet_type', '%moneyline%')
      .gt('game_date', nowIso)
      .lte('game_date', horizon);
    if (error) throw error;

    for (const row of rows || []) {
      summary.checked++;
      try {
        const pickTeam = row.pick?.toLowerCase().includes(row.home_team.toLowerCase())
          ? row.home_team
          : row.pick?.toLowerCase().includes(row.away_team.toLowerCase())
            ? row.away_team : null;
        const storedImplied = impliedPct(String(row.odds || '').replace(/[^0-9-]/g, ''));
        if (!pickTeam || storedImplied == null) { summary.no_market++; continue; }

        const market = await currentPriceFor(row, pickTeam);
        if (!market) { summary.no_market++; continue; }

        // Market moved away from our side: its implied probability of our
        // pick DROPPED since we priced it. That predicts negative CLV.
        // Demote one rung (Strong Play to Play, Play to Lean) now that the
        // 7-10 band is its own tier again (2026-08-16 restore).
        const drift = storedImplied - market.avgImplied;
        if (drift >= DEMOTE_DRIFT_PP) {
          const demotedTier = row.tier === 'Strong Play' ? 'Play' : 'Lean';
          const hist = withTierHistory(row.tier, row.tier_history,
            historyEntry(demotedTier, row.odds, row.edge_pp));
          const { error: upErr } = await supabase
            .from('ai_suggestions')
            .update({
              tier: demotedTier,
              ...(hist ? { tier_history: hist } : {}),
              last_revised_at: new Date().toISOString(),
            })
            .eq('id', row.id)
            .eq('actual_outcome', 'pending');
          if (upErr) summary.errors.push(`id ${row.id}: ${upErr.message}`);
          else summary.demoted++;
        } else {
          summary.held++;
        }
      } catch (e) {
        summary.errors.push(`id ${row.id}: ${e.message}`);
      }
    }

    await supabase.from('cron_job_logs').insert({
      job_name: 'reprice-pending-picks',
      status: summary.errors.length === 0 ? 'completed' : 'partial',
      details: JSON.stringify({ ...summary, errors: summary.errors.slice(0, 5), duration_ms: Date.now() - startTime }),
    });
  } catch (error) {
    try {
      await supabase.from('cron_job_logs').insert({
        job_name: 'reprice-pending-picks', status: 'failed',
        details: JSON.stringify({ error: error.message }),
      });
    } catch { /* best-effort */ }
  }
}

async function repricePendingPicks(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.status(202).json({ status: 'accepted', message: 'Reprice sweep started' });
  runReprice().catch(err => console.error('Reprice error:', err.message));
}

module.exports = repricePendingPicks;
