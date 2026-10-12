// Props (shadow): the NFL player prop reads, shown on the site as a
// labeled shadow board (owner 2026-10-12: "display them as shadow", to
// see how the site looks before props publish). Nothing here is a pick
// and nothing touches mv_public_record. Public and read only, the same
// anon pattern as /api/today.
//
// Response: { upcoming: [...], recent: [...], record: { byMarket: [...], total }, asOf }

const { createClient } = require('@supabase/supabase-js');

// Play and above, the same floor the props flip is judged at.
const MIN_PP = 4;
const MAX_UPCOMING = 40;
const RECENT_DAYS = 8;
// Graded since the v2 read started (2026-09-14).
const RECORD_SINCE = '2026-09-14';
const TD_MARKET = 'player_anytime_td';

const MARKET_LABEL = {
  player_receptions: 'receptions',
  player_reception_yds: 'receiving yards',
  player_rush_yds: 'rushing yards',
  player_pass_yds: 'passing yards',
  player_pass_tds: 'passing TDs',
  [TD_MARKET]: 'anytime TD',
};

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Anytime TD reads are only shown on the yes side: books do not sell
 * the no, and the vigged yes anchor flatters every no read. Pure.
 */
function showable(r) {
  if (!r || !r.v2_side || r.v2_edge_pp == null) return false;
  if (!(Number(r.v2_edge_pp) >= MIN_PP)) return false;
  if (r.market === TD_MARKET && r.v2_side !== 'over') return false;
  return Boolean(MARKET_LABEL[r.market]);
}

/** The plain words for a read: "Puka Nacua over 5.5 receptions". Pure. */
function describe(r) {
  if (r.market === TD_MARKET) return `${r.player_name} to score a TD`;
  return `${r.player_name} ${r.v2_side} ${Number(r.line)} ${MARKET_LABEL[r.market]}`;
}

function priceFor(r) {
  const p = r.v2_side === 'over' ? r.consensus_over_price : r.consensus_under_price;
  return Number.isFinite(Number(p)) && Math.abs(Number(p)) >= 100 ? Number(p) : null;
}

function unitsFor(r) {
  if (r.v2_outcome === 'lost') return -1;
  if (r.v2_outcome !== 'won') return 0;
  const p = priceFor(r);
  if (p == null) return 0.909;
  return p > 0 ? p / 100 : 100 / -p;
}

function slim(r) {
  return {
    market: r.market,
    marketLabel: MARKET_LABEL[r.market],
    player: r.player_name,
    side: r.v2_side,
    line: r.line != null ? Number(r.line) : null,
    text: describe(r),
    edgePp: Number(r.v2_edge_pp),
    price: priceFor(r),
    books: r.books,
    commence_time: r.commence_time,
    home_team: r.home_team,
    away_team: r.away_team,
    outcome: r.v2_outcome,
    actual: r.actual_value != null ? Number(r.actual_value) : null,
  };
}

/** Pure shaping of upcoming, recent and graded rows into the response. */
function shapeProps(upcomingRows, recentRows, gradedRows) {
  const upcoming = (upcomingRows || []).filter(showable)
    .sort((a, b) => Number(b.v2_edge_pp) - Number(a.v2_edge_pp))
    .slice(0, MAX_UPCOMING)
    .map(slim);
  const recent = (recentRows || []).filter(r => showable(r) && ['won', 'lost', 'push'].includes(r.v2_outcome))
    .sort((a, b) => String(b.commence_time).localeCompare(String(a.commence_time)) || Number(b.v2_edge_pp) - Number(a.v2_edge_pp))
    .slice(0, 30)
    .map(slim);
  const acc = new Map();
  const total = { won: 0, lost: 0, units: 0 };
  for (const r of (gradedRows || []).filter(showable)) {
    if (!['won', 'lost'].includes(r.v2_outcome)) continue;
    if (!acc.has(r.market)) acc.set(r.market, { market: r.market, label: MARKET_LABEL[r.market], won: 0, lost: 0, units: 0 });
    const m = acc.get(r.market);
    const u = unitsFor(r);
    if (r.v2_outcome === 'won') { m.won++; total.won++; } else { m.lost++; total.lost++; }
    m.units += u; total.units += u;
  }
  const round = (x) => Math.round(x * 10) / 10;
  const byMarket = [...acc.values()]
    .map(m => ({ ...m, units: round(m.units) }))
    .sort((a, b) => b.units - a.units);
  return { upcoming, recent, record: { byMarket, total: { ...total, units: round(total.units) }, since: RECORD_SINCE, minPp: MIN_PP } };
}

const COLS = 'market, player_name, line, v2_side, v2_edge_pp, v2_outcome, consensus_over_price, consensus_under_price, books, commence_time, home_team, away_team, actual_value';

async function props(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const supabase = getSupabase();
  if (!supabase) { res.status(500).json({ error: 'Supabase not configured' }); return; }

  try {
    const now = new Date();
    const recentFrom = new Date(now.getTime() - RECENT_DAYS * 24 * 3600 * 1000).toISOString();
    const [upRes, recentRes] = await Promise.all([
      supabase.from('prop_reads').select(COLS).gt('commence_time', now.toISOString()).gte('v2_edge_pp', MIN_PP).limit(500),
      supabase.from('prop_reads').select(COLS).gte('commence_time', recentFrom).lt('commence_time', now.toISOString()).gte('v2_edge_pp', MIN_PP).limit(1000),
    ]);
    const graded = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('prop_reads').select(COLS)
        .gte('commence_time', RECORD_SINCE).in('v2_outcome', ['won', 'lost']).gte('v2_edge_pp', MIN_PP)
        .order('id', { ascending: true }).range(from, from + 999);
      if (error) throw error;
      graded.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const err = upRes.error || recentRes.error;
    if (err) { res.status(500).json({ error: err.message }); return; }
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.json({ ...shapeProps(upRes.data, recentRes.data, graded), asOf: now.toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = props;
module.exports.shapeProps = shapeProps;
module.exports.showable = showable;
module.exports.describe = describe;
