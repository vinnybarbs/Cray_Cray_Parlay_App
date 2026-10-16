// POST /api/tracked/outcomes: the official grade for the bets a user
// tracks (owner 2026-10-16). The Tracked tab keeps its list in the
// browser (and tracked_bets for a signed in user) and asks here for
// how each one settled: Board plays from ai_suggestions, props from
// prop_reads. Read only, never gated: a tracked pick was public when it
// was tracked. Grades come from the ledger as graded, nothing here
// re-grades anything.

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../shared/logger');

const MAX_ITEMS = 200;
const DAY_MS = 86400e3;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

const gameMatch = (home, away, pick) => `${home}|${away}|${pick}`;
const propMatch = (playerKey, market, side, line) => `${playerKey}|${market}|${side}|${Number(line)}`;

function timeRange(times) {
  const ms = times.map(t => new Date(t).getTime()).filter(Number.isFinite);
  if (ms.length === 0) return null;
  return {
    from: new Date(Math.min(...ms) - DAY_MS).toISOString(),
    to: new Date(Math.max(...ms) + DAY_MS).toISOString(),
  };
}

/** Grades for the Board plays in the list, keyed by item key. Pure given rows. */
function gameOutcomes(items, rows) {
  const byMatch = new Map();
  for (const r of rows || []) {
    const k = gameMatch(r.home_team, r.away_team, r.pick);
    // Several rows can carry one pick over revisions; a graded one wins.
    const prev = byMatch.get(k);
    if (!prev || (prev.actual_outcome === 'pending' && r.actual_outcome !== 'pending')) byMatch.set(k, r);
  }
  const out = {};
  for (const it of items) {
    const r = byMatch.get(gameMatch(it.home_team, it.away_team, it.pick));
    if (r) out[it.key] = { outcome: r.actual_outcome || 'pending', tier: r.tier || null };
  }
  return out;
}

/** Grades for the props in the list, keyed by item key. Pure given rows. */
function propOutcomes(items, rows) {
  const byMatch = new Map();
  for (const r of rows || []) {
    const k = propMatch(r.player_key, r.market, r.v2_side, r.line);
    const prev = byMatch.get(k);
    if (!prev || (!prev.v2_outcome && r.v2_outcome)) byMatch.set(k, r);
  }
  const out = {};
  for (const it of items) {
    const r = byMatch.get(propMatch(it.playerKey, it.market, it.side, it.line));
    if (r) out[it.key] = { outcome: r.v2_outcome || 'pending', actual: r.actual_value != null ? Number(r.actual_value) : null };
  }
  return out;
}

async function getTrackedOutcomes(req, res, deps = {}) {
  const supabase = deps.supabase || getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
  const body = req.body || {};
  const games = (Array.isArray(body.games) ? body.games : []).filter(g => g && g.key && g.home_team && g.away_team && g.pick).slice(0, MAX_ITEMS);
  const props = (Array.isArray(body.props) ? body.props : []).filter(p => p && p.key && p.playerKey && p.market && p.side && p.line != null).slice(0, MAX_ITEMS);
  try {
    const [gameRows, propRows] = await Promise.all([
      (async () => {
        const range = timeRange(games.map(g => g.game_date));
        if (!range) return [];
        const { data, error } = await supabase
          .from('ai_suggestions')
          .select('home_team, away_team, pick, tier, actual_outcome, game_date')
          .like('session_id', 'auto_digest%')
          .is('voided_at', null)
          .in('home_team', [...new Set(games.map(g => g.home_team))])
          .gte('game_date', range.from)
          .lte('game_date', range.to)
          .limit(1000);
        if (error) throw error;
        return data || [];
      })(),
      (async () => {
        const range = timeRange(props.map(p => p.commence_time));
        if (!range) return [];
        const { data, error } = await supabase
          .from('prop_reads')
          .select('player_key, market, v2_side, line, v2_outcome, actual_value, commence_time')
          .in('player_key', [...new Set(props.map(p => p.playerKey))])
          .gte('commence_time', range.from)
          .lte('commence_time', range.to)
          .limit(1000);
        if (error) throw error;
        return data || [];
      })(),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ games: gameOutcomes(games, gameRows), props: propOutcomes(props, propRows), asOf: new Date().toISOString() });
  } catch (err) {
    logger.warn('tracked outcomes failed', { error: err.message });
    res.json({ games: {}, props: {}, asOf: new Date().toISOString(), error: 'unavailable' });
  }
}

module.exports = { getTrackedOutcomes, gameOutcomes, propOutcomes };
