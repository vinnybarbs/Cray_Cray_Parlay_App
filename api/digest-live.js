// GET /api/digest/live: the Board's game tracker (owner 2026-10-16).
// Score, clock and where each published pick or trap stands, for games
// that started in the last 8 hours. Polled by the Board every 30 seconds
// while a started card is on screen. One cached ESPN scoreboard per
// sport per 30 seconds however many visitors poll. Started picks are
// never gated, the pick was public at lock.

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../shared/logger');
const { attachPublishedPicks } = require('./digest');
const { liveGames } = require('../lib/services/live-game-scores.js');

const STARTED_WINDOW_HOURS = 8;
const COLS = 'game_key, home_team, away_team, game_date, sport, spread, total, trap_calls';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function getDigestLive(req, res, deps = {}) {
  const supabase = deps.supabase || getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
  try {
    const now = new Date();
    const since = new Date(now.getTime() - STARTED_WINDOW_HOURS * 3600e3).toISOString();
    const { data, error } = await supabase
      .from('game_analysis')
      .select(COLS)
      .gte('game_date', since)
      .lte('game_date', now.toISOString());
    if (error) throw error;
    const rows = data || [];
    await attachPublishedPicks(supabase, rows, { started: true });
    const live = await liveGames(rows, { fetchFn: deps.fetchFn || fetch, now: now.getTime() });
    res.setHeader('Cache-Control', 'no-store');
    res.json(live);
  } catch (err) {
    logger.warn('digest live failed', { error: err.message });
    res.json({ games: {}, asOf: new Date().toISOString(), error: 'unavailable' });
  }
}

module.exports = { getDigestLive };
