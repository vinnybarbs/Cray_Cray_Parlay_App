/**
 * CRON: Sync NFL player box-score stats into player_game_stats.
 *
 * The grading feed for player props: every prop settles against what the
 * player actually did, and ESPNPlayerStatsBoxScore already knows how to
 * parse NFL box scores, it just never had a cron driving it. Runs daily
 * during the season (and preseason, those reps are what train the props
 * model before anything publishes), scanning the trailing window of
 * completed games.
 *
 * Endpoint: POST /cron/sync-nfl-player-stats?secret=...&days=2
 */

const { supabase } = require('../../lib/middleware/supabaseAuth.js');
const { ESPNPlayerStatsBoxScore } = require('../../lib/services/espn-player-stats-boxscore.js');

const DEFAULT_DAYS = 2;
const MAX_DAYS = 10;

async function runSync(days, sport) {
  const startTime = Date.now();
  const summary = { sport, days, games: 0, players_cached: 0, errors: [] };
  try {
    const svc = new ESPNPlayerStatsBoxScore();
    const games = await svc.getRecentGames(sport, days);
    summary.games = (games || []).length;
    for (const game of games || []) {
      try {
        const gameId = game?.id || game;
        const stats = await svc.getBoxScore(gameId, sport);
        if (Array.isArray(stats) && stats.length > 0) {
          await svc.cachePlayerStats(stats, sport);
          summary.players_cached += stats.length;
        }
      } catch (e) {
        summary.errors.push(`game ${game?.id || game}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 250));
    }
    await supabase.from('cron_job_logs').insert({
      job_name: 'sync-nfl-player-stats',
      status: summary.errors.length === 0 ? 'completed' : 'partial',
      details: JSON.stringify({ ...summary, errors: summary.errors.slice(0, 5), duration_ms: Date.now() - startTime }),
    });
  } catch (error) {
    try {
      await supabase.from('cron_job_logs').insert({
        job_name: 'sync-nfl-player-stats', status: 'failed',
        details: JSON.stringify({ error: error.message }),
      });
    } catch { /* best-effort */ }
  }
}

async function syncNflPlayerStats(req, res) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const days = Math.min(MAX_DAYS, Math.max(1, parseInt(req.query.days, 10) || DEFAULT_DAYS));
  const sport = req.query.sport === 'NCAAF' ? 'NCAAF' : 'NFL';
  res.status(202).json({ status: 'accepted', message: `Player stats sync started (${sport}, ${days} days)` });
  runSync(days, sport).catch(err => console.error('Player stats sync error:', err.message));
}

module.exports = syncNflPlayerStats;
