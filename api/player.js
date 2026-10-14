// Player sheet: one NFL player's game log, red zone usage and every
// prop read we have made on them, graded (owner 2026-10-13: "a clickable
// player with some stats and summary", to give the props some
// interactivity). Public and read only, the same anon pattern as
// /api/props. Built only from tables we already sync (nflverse game
// stats and red zone usage), no outside API.
//
// GET /api/player?key=<player_key>
// Response: { player: { name, team, position }, season, games: [...],
//   averages: {...}, redzone: {...} | null, reads: [...], record, asOf }

const { createClient } = require('@supabase/supabase-js');
const { showable, describe } = require('./props');
const { summarizeRedzone } = require('./cron/narrate-nfl-props');
const { viewerSeesAll, gatePlayer } = require('../lib/services/paywall.js');

const MAX_GAMES = 17;
const MAX_READS = 25;
// Shown reads only, graded since the v2 read started, same as /api/props.
const RECORD_SINCE = '2026-09-14';
const STATS = ['completions', 'attempts', 'passing_yards', 'passing_tds', 'interceptions', 'carries', 'rushing_yards', 'rushing_tds', 'targets', 'receptions', 'receiving_yards', 'receiving_tds'];

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

const num = (x) => (x == null || !Number.isFinite(Number(x)) ? 0 : Number(x));
const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Shape stat rows (any order) and read rows into the sheet. The game log
 * is the latest season's regular and post season games, newest first.
 * Averages cover the same games. Pure.
 */
function shapePlayer(statRows, readRows, redzone) {
  const rows = (statRows || []).slice().sort((a, b) => (b.season - a.season) || (b.week - a.week));
  const latest = rows[0] || null;
  const season = latest ? latest.season : null;
  const games = rows.filter(g => g.season === season).slice(0, MAX_GAMES).map(g => {
    const out = { season: g.season, week: g.week, team: g.team || null, opponent: g.opponent || null };
    for (const k of STATS) out[k] = num(g[k]);
    return out;
  });
  const averages = {};
  if (games.length > 0) {
    for (const k of STATS) averages[k] = round1(games.reduce((a, g) => a + g[k], 0) / games.length);
  }
  // Which stat columns this player actually uses, so the sheet does not
  // print a wall of zeros for a receiver's passing line.
  const used = STATS.filter(k => games.some(g => g[k] > 0));

  const reads = (readRows || []).filter(showable)
    .sort((a, b) => String(b.commence_time).localeCompare(String(a.commence_time)) || Number(b.v2_edge_pp) - Number(a.v2_edge_pp))
    .slice(0, MAX_READS)
    .map(r => ({
      text: describe(r),
      // The read without the player's name, "over 5.5 receptions".
      label: r.player_name ? describe(r).replace(`${r.player_name} `, '') : describe(r),
      market: r.market,
      side: r.v2_side,
      line: r.line != null ? Number(r.line) : null,
      edgePp: Number(r.v2_edge_pp),
      commence_time: r.commence_time,
      opponent: r.v2_factors?.opponent || null,
      outcome: r.v2_outcome,
      actual: r.actual_value != null ? Number(r.actual_value) : null,
    }));
  const record = { won: 0, lost: 0, push: 0 };
  for (const r of reads) if (record[r.outcome] != null) record[r.outcome]++;

  return {
    player: latest ? { name: latest.player_name, team: latest.team || null, position: latest.position || null } : null,
    season,
    games,
    used,
    averages,
    redzone: redzone || null,
    reads,
    record,
  };
}

async function player(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const key = String(req.query?.key || '').trim().toLowerCase();
  if (!key || key.length > 80) { res.status(400).json({ error: 'key required' }); return; }

  const supabase = getSupabase();
  if (!supabase) { res.status(500).json({ error: 'Supabase not configured' }); return; }

  try {
    const [statRes, readRes] = await Promise.all([
      supabase.from('nfl_player_game_stats')
        .select(`season, week, player_id, player_name, position, team, opponent, ${STATS.join(', ')}`)
        .eq('player_key', key)
        .order('season', { ascending: false }).order('week', { ascending: false })
        .limit(40),
      supabase.from('prop_reads')
        .select('market, player_name, line, v2_side, v2_edge_pp, v2_outcome, v2_factors, actual_value, commence_time')
        .eq('player_key', key)
        .gte('commence_time', RECORD_SINCE)
        .order('commence_time', { ascending: false })
        .limit(200),
    ]);
    if (statRes.error) throw statRes.error;
    if (readRes.error) throw readRes.error;

    // Red zone usage over the last four games. A failure only drops it.
    let redzone = null;
    const playerId = (statRes.data || []).find(r => r.player_id)?.player_id;
    if (playerId) {
      const { data, error } = await supabase.from('nfl_player_redzone')
        .select('player_id, season, week, rz_carries, gl_carries, rz_targets, team_rz_carries, team_rz_targets')
        .eq('player_id', playerId)
        .order('season', { ascending: false }).order('week', { ascending: false })
        .limit(8);
      if (!error && data) redzone = summarizeRedzone(data, new Map([[playerId, key]])).get(key) || null;
    }

    const shaped = shapePlayer(statRes.data, readRes.data, redzone);
    if (!shaped.player) {
      // No game log yet, still name the player from the reads.
      const name = (readRes.data || [])[0]?.player_name || null;
      shaped.player = name ? { name, team: null, position: null } : null;
    }
    if (!shaped.player) { res.status(404).json({ error: 'Player not found' }); return; }
    const access = await viewerSeesAll(req, res);
    if (!access.viewer) res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    const body = { ...shaped, asOf: new Date().toISOString() };
    res.json(access.all ? body : gatePlayer(body));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = player;
module.exports.shapePlayer = shapePlayer;
