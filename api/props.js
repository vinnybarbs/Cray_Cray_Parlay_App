// Props (shadow): the NFL player prop reads, shown on the site as a
// labeled shadow board (owner 2026-10-12: "display them as shadow", to
// see how the site looks before props publish). Nothing here is a pick
// and nothing touches mv_public_record. Public and read only, the same
// anon pattern as /api/today.
//
// Response: { upcoming: [...], live: [...], recent: [...], record: { byMarket: [...], total }, asOf }
// live holds reads whose game started in the last 8 hours, with their why.
// Each upcoming read also carries ourProb and bookProb for its side and
// history, the player's last games against the line (UI plan item 6).

const { createClient } = require('@supabase/supabase-js');
const { teamAbbr } = require('../lib/services/nfl-inactives');
const { SHOP_BOOKS, shopProp } = require('../lib/services/line-shop.js');
const { viewerSeesAll, gateProps } = require('../lib/services/paywall.js');
const { liveProgress } = require('../lib/services/live-prop-stats.js');

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

// The stat a market is graded on, from one nfl_player_game_stats row.
// Anytime TD counts rushing plus receiving scores. Pure.
const STAT_FOR = {
  player_receptions: g => g.receptions,
  player_reception_yds: g => g.receiving_yards,
  player_rush_yds: g => g.rushing_yards,
  player_pass_yds: g => g.passing_yards,
  player_pass_tds: g => g.passing_tds,
  [TD_MARKET]: g => (Number(g.rushing_tds) || 0) + (Number(g.receiving_tds) || 0),
};
const HISTORY_GAMES = 10;

/**
 * Probability of the read's own side, ours (v2) and the book's no-vig
 * anchor, both stored as the over probability. Pure.
 */
function sideProbs(r) {
  const flip = (x) => (x == null || !Number.isFinite(Number(x)) ? null : (r.v2_side === 'over' ? Number(x) : 1 - Number(x)));
  const pct = (x) => (x == null ? null : Math.round(x * 1000) / 10);
  return { ourProb: pct(flip(r.v2_prob)), bookProb: pct(flip(r.anchor_prob)) };
}

// A real American price or null. Pure.
function cleanPrice(p) {
  return Number.isFinite(Number(p)) && Math.abs(Number(p)) >= 100 ? Number(p) : null;
}

function slim(r) {
  return {
    ...sideProbs(r),
    overPrice: cleanPrice(r.consensus_over_price),
    underPrice: cleanPrice(r.consensus_under_price),
    homeAbbr: teamAbbr(r.home_team) || null,
    awayAbbr: teamAbbr(r.away_team) || null,
    playerKey: r.player_key,
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
    why: whyFor(r),
  };
}

/**
 * What the card's expanding explanation shows: the short narration, but
 * only while it still argues this read's side at this line, and the
 * numbers behind the read. Null when there is nothing to show. Pure.
 */
function whyFor(r) {
  const f = r.v2_factors || {};
  const base = r.factors || {};
  const num = (x, d = 1) => (x == null || !Number.isFinite(Number(x)) ? null : Math.round(Number(x) * 10 ** d) / 10 ** d);
  const fresh = r.narration && r.narration_side === r.v2_side && Number(r.narration_line) === Number(r.line);
  const oppPct = f.opp_ratio != null && Number(f.opp_games) >= 4 ? Math.round((Number(f.opp_ratio) - 1) * 100) : null;
  const why = {
    narration: fresh ? r.narration : null,
    detail: fresh && r.narration_detail ? r.narration_detail : null,
    projection: r.market === TD_MARKET ? null : num(r.v2_mean),
    recentAvg: num(base.recent_mean),
    longAvg: num(base.long_mean),
    opponent: f.opponent || null,
    oppPct,
    teamImplied: num(f.team_implied),
    windMph: f.wind_mph != null && Number(f.wind_mph) >= 12 ? Math.round(Number(f.wind_mph)) : null,
    status: f.status || null,
  };
  return Object.values(why).some(v => v != null) ? why : null;
}

/**
 * Attach the last HISTORY_GAMES games for each upcoming read, oldest
 * first, with whether each one cleared the line on the read's side.
 * statRows come from nfl_player_game_stats for the reads' player keys,
 * any order. A push (value exactly on the line) counts as no hit. Pure.
 */
function attachHistory(upcoming, statRows) {
  const byPlayer = new Map();
  for (const g of statRows || []) {
    if (!byPlayer.has(g.player_key)) byPlayer.set(g.player_key, []);
    byPlayer.get(g.player_key).push(g);
  }
  for (const games of byPlayer.values()) {
    games.sort((a, b) => (a.season - b.season) || (a.week - b.week));
  }
  return upcoming.map(p => {
    const stat = STAT_FOR[p.market];
    const games = (byPlayer.get(p.playerKey) || []).slice(-HISTORY_GAMES);
    if (!stat || p.line == null || games.length === 0) return { ...p, history: null };
    const rows = games.map(g => {
      const value = Number(stat(g)) || 0;
      const hit = p.side === 'over' ? value > p.line : value < p.line;
      return { season: g.season, week: g.week, opponent: g.opponent || null, value, hit };
    });
    const last = games[games.length - 1];
    return { ...p, team: last.team || null, history: { games: rows, hits: rows.filter(x => x.hit).length } };
  });
}

/** Pure shaping of upcoming, recent and graded rows into the response. */
function shapeProps(upcomingRows, recentRows, gradedRows, liveRows = []) {
  const upcoming = (upcomingRows || []).filter(showable)
    .sort((a, b) => Number(b.v2_edge_pp) - Number(a.v2_edge_pp))
    .slice(0, MAX_UPCOMING)
    .map(slim);
  // Reads whose game already kicked off, kept with their why so a bettor
  // can look back at what the read was (owner 2026-10-13). They are locked:
  // the line and price are the last ones before kickoff.
  const live = (liveRows || []).filter(showable)
    .sort((a, b) => Number(b.v2_edge_pp) - Number(a.v2_edge_pp))
    .slice(0, MAX_UPCOMING)
    .map(r => ({ ...slim(r), started: true }));
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
  return { upcoming, live, recent, record: { byMarket, total: { ...total, units: round(total.units) }, since: RECORD_SINCE, minPp: MIN_PP } };
}

// How long a started read stays up, same window as the game board.
const STARTED_WINDOW_HOURS = 8;

// The upcoming board also carries what the expanding explanation needs.
const WHY_COLS = 'v2_mean, v2_factors, factors, narration, narration_detail, narration_side, narration_line';
const COLS = 'market, player_key, player_name, v2_prob, anchor_prob, line, v2_side, v2_edge_pp, v2_outcome, consensus_over_price, consensus_under_price, books, commence_time, home_team, away_team, actual_value';

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
    const liveFrom = new Date(now.getTime() - STARTED_WINDOW_HOURS * 3600 * 1000).toISOString();
    // Order matters: the names below bind by position.
    const [upRes, liveRes, recentRes] = await Promise.all([
      supabase.from('prop_reads').select(`${COLS}, ${WHY_COLS}`).gt('commence_time', now.toISOString()).gte('v2_edge_pp', MIN_PP).limit(500),
      supabase.from('prop_reads').select(`${COLS}, ${WHY_COLS}`).gte('commence_time', liveFrom).lte('commence_time', now.toISOString()).gte('v2_edge_pp', MIN_PP).limit(500),
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
    // A failed live query drops the started list, never the board.
    const shaped = shapeProps(upRes.data, recentRes.data, graded, liveRes.error ? [] : liveRes.data);
    // Last games for the upcoming reads. A failure here only drops the
    // chart, never the board.
    const keys = [...new Set([...shaped.upcoming, ...shaped.live].map(p => p.playerKey).filter(Boolean))];
    let statRows = [];
    if (keys.length > 0) {
      const { data, error } = await supabase.from('nfl_player_game_stats')
        .select('player_key, season, week, team, opponent, receptions, receiving_yards, rushing_yards, passing_yards, passing_tds, rushing_tds, receiving_tds')
        .in('player_key', keys)
        .order('season', { ascending: false }).order('week', { ascending: false })
        .limit(keys.length * 25);
      if (!error) statRows = data || [];
    }
    // Line shopping at the read's own line (build_queue 105). Only the
    // upcoming board, and a failure only drops the chips.
    if (shaped.upcoming.length > 0) {
      const { data, error } = await supabase.from('player_props')
        .select('player_key, market, line, over_price, under_price, yes_price, bookmaker, commence_time')
        .in('player_key', [...new Set(shaped.upcoming.map(p => p.playerKey).filter(Boolean))])
        .in('bookmaker', SHOP_BOOKS)
        .gt('commence_time', now.toISOString())
        .limit(5000);
      if (!error) shaped.upcoming = shaped.upcoming.map(p => ({ ...p, shop: shopProp(data, p) }));
    }
    shaped.upcoming = attachHistory(shaped.upcoming, statRows);
    shaped.live = attachHistory(shaped.live, statRows);
    const access = await viewerSeesAll(req, res);
    if (!access.viewer) res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    const body = { ...shaped, asOf: now.toISOString() };
    res.json(access.all ? body : gateProps(body));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /api/props/live: the live tracker for started reads (owner
 * 2026-10-16). The player's stat so far against the line and whether it
 * already hit or missed, from the ESPN live box score. Polled by the
 * props page while any read is started, so it stays light: one query,
 * one cached ESPN summary per game. Started reads are never gated.
 */
async function propsLive(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const supabase = getSupabase();
  if (!supabase) { res.status(500).json({ error: 'Supabase not configured' }); return; }
  try {
    const now = new Date();
    const liveFrom = new Date(now.getTime() - STARTED_WINDOW_HOURS * 3600 * 1000).toISOString();
    const { data, error } = await supabase.from('prop_reads').select(COLS)
      .gte('commence_time', liveFrom).lte('commence_time', now.toISOString())
      .gte('v2_edge_pp', MIN_PP).limit(500);
    if (error) { res.status(500).json({ error: error.message }); return; }
    const reads = (data || []).filter(showable).map(slim);
    const live = reads.length ? await liveProgress(reads) : { games: {}, reads: {} };
    res.setHeader('Cache-Control', 'public, max-age=20, s-maxage=20');
    res.json({ ...live, asOf: now.toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = props;
module.exports.propsLive = propsLive;
module.exports.shapeProps = shapeProps;
module.exports.showable = showable;
module.exports.describe = describe;
module.exports.attachHistory = attachHistory;
module.exports.sideProbs = sideProbs;
module.exports.whyFor = whyFor;
