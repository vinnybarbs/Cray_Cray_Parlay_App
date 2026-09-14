/**
 * CRON: Late scratch watch for NFL picks near kickoff.
 *
 * The inactives post 90 minutes before kickoff and the market moves on
 * them within minutes. This job reads ESPN's per game injuries block for
 * every pending NFL pick or leg starting inside the window, diffs it
 * against the report the analysis was priced on (edge_factors.
 * injuryReport, stored by the edge calculator since 2026-09-14), and on
 * a player newly Out marks the game's analysis stale and re-runs the
 * NFL pre-analysis. The existing formula, gate, rails and change gate do
 * the rest: the pick revises through upsertDailySuggestion with a
 * tier_history entry like any intraday revision. No new rail, no weight,
 * no label swap (directive 16).
 *
 * Cost: one narration per scratched game, a handful a week. A run with
 * nothing in the window still logs a row, so silence is never mistaken
 * for health (directive 14, the reprice principle).
 *
 * Endpoint: POST /cron/watch-nfl-inactives?secret=...
 * Schedule: every 15 minutes (pg_cron, migration 20260914200000).
 */

'use strict';

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const {
  findEspnEventId, fetchGameInjuries, linesForTeam, diffScratches,
} = require('../../lib/services/nfl-inactives.js');
const { overrideTeams } = require('../../lib/services/football-injuries.js');

const WINDOW_HOURS = 3;
const NFL_SLUGS = ['americanfootball_nfl'];

async function pendingNflGames() {
  const nowIso = new Date().toISOString();
  const horizon = new Date(Date.now() + WINDOW_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from('ai_suggestions')
    .select('id, home_team, away_team, game_date, pick, tier')
    .eq('sport', 'NFL')
    .like('session_id', 'auto_digest%')
    .eq('actual_outcome', 'pending')
    .is('voided_at', null)
    .gt('game_date', nowIso)
    .lte('game_date', horizon);
  if (error) throw error;
  const games = new Map();
  for (const r of data || []) {
    const key = `${r.home_team}|${r.away_team}|${String(r.game_date).slice(0, 10)}`;
    if (!games.has(key)) games.set(key, { home_team: r.home_team, away_team: r.away_team, game_date: r.game_date, picks: [] });
    games.get(key).picks.push({ id: r.id, pick: r.pick, tier: r.tier });
  }
  return [...games.values()];
}

async function latestAnalysis(game) {
  const lo = new Date(new Date(game.game_date).getTime() - 6 * 3600 * 1000).toISOString();
  const hi = new Date(new Date(game.game_date).getTime() + 6 * 3600 * 1000).toISOString();
  const { data } = await supabase
    .from('game_analysis')
    .select('id, game_key, generated_at, stale, edge_factors')
    .eq('sport', 'NFL')
    .eq('home_team', game.home_team)
    .eq('away_team', game.away_team)
    .gte('game_date', lo)
    .lte('game_date', hi)
    .order('generated_at', { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

async function runWatch({ reanalyze } = {}) {
  const startTime = Date.now();
  const summary = { checked: 0, no_analysis: 0, no_event: 0, no_summary: 0, no_prior_report: 0, clean: 0, scratches: [], reanalyzed: false, errors: [] };
  try {
    const games = await pendingNflGames();
    summary.checked = games.length;
    const staleKeys = [];
    // Game summary lines for the clubs that scratched, overlaid on the
    // league feed cache before the re-analysis so the math sees the Out.
    const freshLines = {};

    for (const game of games) {
      const label = `${game.away_team} at ${game.home_team}`;
      try {
        const analysis = await latestAnalysis(game);
        if (!analysis) { summary.no_analysis++; continue; }
        const eventId = await findEspnEventId(game.home_team, game.away_team, game.game_date);
        if (!eventId) { summary.no_event++; continue; }
        const byTeam = await fetchGameInjuries(eventId);
        if (!byTeam) { summary.no_summary++; continue; }

        const report = analysis.edge_factors?.injuryReport || null;
        let found = 0;
        for (const side of ['home', 'away']) {
          const teamName = side === 'home' ? game.home_team : game.away_team;
          const diff = diffScratches(report ? report[side] : null, linesForTeam(byTeam, teamName) || []);
          if (diff === null) { summary.no_prior_report++; found = -1; break; }
          for (const s of diff) {
            found++;
            summary.scratches.push({ game: label, team: teamName, ...s, picks: game.picks.map(p => `${p.tier}: ${p.pick}`) });
          }
        }
        if (found > 0) {
          for (const teamName of [game.home_team, game.away_team]) {
            const lines = linesForTeam(byTeam, teamName);
            if (lines) freshLines[teamName] = lines;
          }
          if (!analysis.stale) {
            const { error } = await supabase.from('game_analysis').update({ stale: true }).eq('id', analysis.id);
            if (error) summary.errors.push(`${label}: stale mark ${error.message}`);
          }
          staleKeys.push(analysis.game_key);
        } else if (found === 0) {
          summary.clean++;
        }
      } catch (e) {
        summary.errors.push(`${label}: ${e.message}`);
      }
    }

    if (staleKeys.length > 0) {
      try { await overrideTeams(freshLines); }
      catch (e) { summary.errors.push(`override: ${e.message}`); }
      const run = reanalyze || require('./pre-analyze-games.js').runPreAnalysis;
      // Fire and forget: the pre-analysis logs its own started and
      // completed rows under pre-analyze-NFL.
      Promise.resolve().then(() => run(NFL_SLUGS)).catch(err => console.error('Inactives re-analysis error:', err.message));
      summary.reanalyzed = true;
      summary.stale_keys = staleKeys;
    }

    await supabase.from('cron_job_logs').insert({
      job_name: 'watch-nfl-inactives',
      status: summary.errors.length === 0 ? 'completed' : 'partial',
      details: JSON.stringify({ ...summary, errors: summary.errors.slice(0, 5), duration_ms: Date.now() - startTime }),
    });
  } catch (error) {
    try {
      await supabase.from('cron_job_logs').insert({
        job_name: 'watch-nfl-inactives', status: 'failed',
        details: JSON.stringify({ error: error.message }),
      });
    } catch { /* best-effort */ }
  }
  return summary;
}

async function watchNflInactives(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.status(202).json({ status: 'accepted', message: 'NFL inactives watch started' });
  runWatch().catch(err => console.error('NFL inactives watch error:', err.message));
}

module.exports = watchNflInactives;
module.exports.runWatch = runWatch;
module.exports.WINDOW_HOURS = WINDOW_HOURS;
