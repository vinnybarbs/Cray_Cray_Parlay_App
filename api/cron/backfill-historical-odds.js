/**
 * CRON: work through the historical odds backfill queue.
 *
 * POST /cron/backfill-historical-odds?secret=...   every 15 minutes
 *
 * historical_odds_jobs holds one row per sport and month window (seeded by
 * migration). Each run claims pending windows, newest first, until
 * MAX_RUN_MS is spent, and backfills their closes into
 * historical_closing_lines (lib/services/historical-odds.js). A finished
 * queue makes the run a no-op that logs nothing. Responds 202 at once.
 * One run at a time: a window marked running in the last hour blocks a
 * new run, so overlapping fires never double spend credits.
 *
 * A window whose markets are all player props goes to the per event
 * backfill (historical_prop_closes). After an NFL prop window, a season
 * with no nflverse stat lines yet is synced once, so the
 * historical_prop_results view can grade it.
 */

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { backfillWindow, backfillPropsWindow, isPropMarkets } = require('../../lib/services/historical-odds.js');
const { runSync: syncNflverseSeason } = require('./sync-nflverse-player-stats.js');

const MAX_RUN_MS = 10 * 60 * 1000;

/** NFL season label for a window start date (seasons start in September). */
function nflSeasonOf(windowStart) {
  const [y, m] = String(windowStart).split('-').map(Number);
  return m >= 8 ? y : y - 1;
}

async function ensureNflStats(season, synced) {
  if (synced.has(season)) return;
  synced.add(season);
  const { count } = await supabase.from('nfl_player_game_stats')
    .select('id', { count: 'exact', head: true }).eq('season', season);
  if ((count || 0) === 0) await syncNflverseSeason(season);
}

async function run() {
  const started = Date.now();
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error('ODDS_API_KEY not set');

  const { data: busy } = await supabase
    .from('historical_odds_jobs')
    .select('sport')
    .eq('status', 'running')
    .gt('started_at', new Date(Date.now() - 3600 * 1000).toISOString())
    .limit(1);
  if (busy && busy.length) return null;

  const done = [];
  const synced = new Set();
  while (Date.now() - started < MAX_RUN_MS) {
    const { data: next } = await supabase
      .from('historical_odds_jobs')
      .select('sport, window_start, window_end, markets')
      .in('status', ['pending', 'running'])
      .order('priority', { ascending: true })
      .order('window_start', { ascending: false })
      .limit(1);
    const job = next && next[0];
    if (!job) break;
    const key = { sport: job.sport, window_start: job.window_start, markets: job.markets };
    await supabase.from('historical_odds_jobs')
      .update({ status: 'running', started_at: new Date().toISOString() }).match(key);
    try {
      const props = isPropMarkets(job.markets);
      const fn = props ? backfillPropsWindow : backfillWindow;
      const r = await fn({ fetchFn: fetch, supabase, apiKey, ...job, windowStart: job.window_start, windowEnd: job.window_end });
      if (props && job.sport === 'americanfootball_nfl') await ensureNflStats(nflSeasonOf(job.window_start), synced);
      await supabase.from('historical_odds_jobs').update({
        status: 'done', events: r.events, kickoffs: r.kickoffs, games_with_close: r.gamesWithClose,
        rows_written: r.rowsWritten, credits_used: r.credits, done_at: new Date().toISOString(), error: null,
      }).match(key);
      done.push({ ...key, ...r });
    } catch (err) {
      await supabase.from('historical_odds_jobs')
        .update({ status: 'failed', error: err.message.slice(0, 500), done_at: new Date().toISOString() }).match(key);
      done.push({ ...key, error: err.message.slice(0, 200) });
    }
  }
  if (done.length === 0) return null;

  const credits = done.reduce((s, d) => s + (d.credits || 0), 0);
  const failed = done.filter((d) => d.error).length;
  const details = { windows: done, credits, failed, duration_ms: Date.now() - started };
  await supabase.from('cron_job_logs').insert({
    job_name: 'backfill-historical-odds',
    status: failed > 0 ? 'partial' : 'completed',
    details: JSON.stringify(details),
  });
  console.log('📼 backfill-historical-odds', JSON.stringify(details));
  return details;
}

async function backfillHistoricalOdds(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.status(202).json({ accepted: true });
  run().catch(async (err) => {
    console.error('❌ backfill-historical-odds failed:', err.message);
    await supabase.from('cron_job_logs').insert({
      job_name: 'backfill-historical-odds', status: 'failed', details: JSON.stringify({ error: err.message }),
    });
  });
}

module.exports = backfillHistoricalOdds;
module.exports.run = run;
module.exports.nflSeasonOf = nflSeasonOf;
