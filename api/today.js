// Today: the one screen a first time visitor or a home screen install
// opens on (build_queue 96, owner 2026-10-12). The day's best 3 to 5
// published plays in plain words, the traps to stay off, and the record
// underneath. Public and read only, the same anon pattern as
// public-stats and public-pod. Every record number is mv_public_record.
//
// Response: { picks: [...], traps: [...], record: { last30, allTime, trapBait }, asOf }

const { createClient } = require('@supabase/supabase-js');

const HORIZON_HOURS = 30;
const MAX_PICKS = 5;
const MAX_TRAPS = 3;
// Play and above. A Lean is a publishable read, not a play to lead with.
const MIN_PP = 4;
const MIN_SHOWN = 3;
const HEADLINE_SESSION = /^auto_digest_\d{4}-\d{2}-\d{2}$/;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * One row per game: a game that sat on the board across
 * several daily sessions has a row per session, and the newest session
 * is the live publication. Pure.
 */
function latestPerGame(rows) {
  const byKey = new Map();
  for (const r of rows || []) {
    const key = `${r.home_team}|${r.away_team}`;
    const prev = byKey.get(key);
    if (!prev || String(r.session_id) > String(prev.session_id)) byKey.set(key, r);
  }
  return [...byKey.values()];
}

function recordOf(row) {
  if (!row) return null;
  const won = row.won || 0;
  const lost = row.lost || 0;
  const decided = won + lost;
  return {
    won,
    lost,
    push: row.push || 0,
    winRate: decided > 0 ? Math.round((won / decided) * 1000) / 10 : null,
    units: row.roi_units != null ? Math.round(Number(row.roi_units) * 10) / 10 : null,
  };
}

/**
 * Pure shaping of the three queries into the response. Headline picks
 * only (auto_digest_YYYY-MM-DD), not the spotlight alternates, which ride
 * under a headline on the full board.
 */
function shapeToday(pickRows, trapRows, recordRows) {
  const slim = r => ({
    sport: r.sport,
    home_team: r.home_team,
    away_team: r.away_team,
    game_date: r.game_date,
    bet_type: r.bet_type,
    pick: r.pick,
    odds: r.odds,
    edge_pp: r.edge_pp != null ? Number(r.edge_pp) : null,
    tier: r.tier,
  });
  const ranked = latestPerGame((pickRows || []).filter(r => HEADLINE_SESSION.test(String(r.session_id))))
    .sort((a, b) => Number(b.edge_pp) - Number(a.edge_pp));
  const plays = ranked.filter(r => Number(r.edge_pp) >= MIN_PP).slice(0, MAX_PICKS);
  // A quiet day still shows the board: Leans fill up to MIN_SHOWN, and
  // each card carries its tier so a Lean never reads as a Play.
  const fill = plays.length < MIN_SHOWN
    ? ranked.filter(r => Number(r.edge_pp) < MIN_PP).slice(0, MIN_SHOWN - plays.length) : [];
  const picks = [...plays, ...fill].map(slim);
  // A trap's edge is negative, so the most overpriced bait sorts first.
  const traps = latestPerGame(trapRows)
    .sort((a, b) => Number(a.edge_pp) - Number(b.edge_pp))
    .slice(0, MAX_TRAPS)
    .map(slim);
  const find = (bucket, type, value) => (recordRows || []).find(r =>
    r.period_bucket === bucket && r.dimension_type === type && (value == null || r.dimension_value === value));
  return {
    picks,
    traps,
    record: {
      last30: recordOf(find('last_30d', 'overall')),
      allTime: recordOf(find('all', 'overall')),
      // The Trap row is the bait's own record, and its units are what
      // betting the bait cost (owner 2026-10-12: trap means don't bet it).
      trapBait: recordOf(find('all', 'tier', 'Trap')),
    },
  };
}

async function today(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const supabase = getSupabase();
  if (!supabase) { res.status(500).json({ error: 'Supabase not configured' }); return; }

  try {
    const now = new Date();
    const horizon = new Date(now.getTime() + HORIZON_HOURS * 3600 * 1000).toISOString();
    const cols = 'sport, home_team, away_team, game_date, bet_type, pick, odds, edge_pp, tier, session_id';
    const base = () => supabase
      .from('ai_suggestions')
      .select(cols)
      .eq('actual_outcome', 'pending')
      .is('voided_at', null)
      .gt('game_date', now.toISOString())
      .lt('game_date', horizon);
    const [picksRes, trapsRes, recordRes] = await Promise.all([
      base().like('session_id', 'auto_digest%').not('tier', 'in', '("Trap","Leg","Skip")').limit(300),
      base().like('session_id', 'auto_digest_trap_%').limit(100),
      supabase.from('mv_public_record')
        .select('period_bucket, dimension_type, dimension_value, won, lost, push, roi_units')
        .in('period_bucket', ['last_30d', 'all'])
        .in('dimension_type', ['overall', 'tier']),
    ]);
    const err = picksRes.error || trapsRes.error || recordRes.error;
    if (err) { res.status(500).json({ error: err.message }); return; }

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.json({ ...shapeToday(picksRes.data, trapsRes.data, recordRes.data), asOf: now.toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = today;
module.exports.shapeToday = shapeToday;
module.exports.latestPerGame = latestPerGame;
