/**
 * The counterfactual replay harness (build queue: "replay harness before
 * the Monday review"; owner 2026-09-11: "replay julys formula against the
 * last 30 days from today").
 *
 * Runs a formula over the games we actually analyzed in a window, with the
 * data each game would have had at the time, picks the way that formula's
 * pipeline picked, grades against the final score at the stored price, and
 * writes one row per pick to replay_picks. Two formulas today:
 *
 *   july     the frozen 2026-07-22 calculator (lib/replay/edge-calculator-
 *            july.js) with the July reliability multipliers, picking the
 *            best calibrated side at the 2pp gate the way July did.
 *   current  the live calculator, live dials, live band maps, the raw gate
 *            and the price rails, picking the headline side.
 *
 * As-of data: game_results is filtered to dates before the game so a
 * team's record, form, schedule strength and ATS are what they were that
 * morning. news_cache is emptied (the injury text signal has no history;
 * both formulas lose it equally). current_standings is a snapshot and is
 * served as-is to both, a known bias that favors neither. Odds are the
 * stored analysis-time prices from game_analysis; missing spread and total
 * prices default to -110.
 */

'use strict';

const { EdgeCalculator: JulyCalculator } = require('./edge-calculator-july.js');
const { EdgeCalculator: LiveCalculator } = require('../services/edge-calculator.js');
const bandCalibration = require('../services/band-calibration.js');
const { pricePenaltyPp } = require('../services/price-penalties.js');
const { edgeTier } = require('../services/pick-grader.js');

const JULY_MULTIPLIERS = { '__global__': 0.75, 'MLB:ml': 1.20, 'MLB:total': 0.55, 'MLB:spread': 0.60, 'EPL': 0, 'MLS': 0 };
const SPORT_SLUG = { MLB: 'baseball_mlb', NFL: 'americanfootball_nfl', NCAAF: 'americanfootball_ncaaf', NBA: 'basketball_nba', NHL: 'icehockey_nhl', NCAAB: 'basketball_ncaab' };

/** Denver site date for a kickoff instant. */
function siteDate(dateLike) {
  return new Date(dateLike).toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
}

/**
 * A supabase facade that only shows the world as of a date: game_results
 * before that date, no injury news. Everything else passes through.
 */
function asOfSupabase(real, asOfDate) {
  return {
    from(table) {
      const qb = real.from(table);
      if (table !== 'game_results' && table !== 'news_cache') return qb;
      return {
        select: (...args) => {
          const fb = qb.select(...args);
          return table === 'game_results' ? fb.lt('date', asOfDate) : fb.lt('last_updated', '1970-01-02T00:00:00Z');
        },
        insert: (...a) => qb.insert(...a),
        upsert: (...a) => qb.upsert(...a),
        update: (...a) => qb.update(...a),
        delete: (...a) => qb.delete(...a),
      };
    },
    rpc: (...a) => real.rpc(...a),
  };
}

/** Build the calculator's game input from a stored game_analysis row. */
function gameFromAnalysis(row) {
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const mlH = num(row.moneyline_home), mlA = num(row.moneyline_away);
  const spread = num(row.spread), total = num(row.total);
  const markets = {};
  if (mlH != null && mlA != null) markets.h2h = [{ name: row.home_team, price: mlH }, { name: row.away_team, price: mlA }];
  if (spread != null) {
    markets.spreads = [
      { name: row.home_team, point: spread, price: num(row.spread_home_price) ?? -110 },
      { name: row.away_team, point: -spread, price: num(row.spread_away_price) ?? -110 },
    ];
  }
  if (total != null) {
    markets.totals = [
      { name: 'Over', point: total, price: num(row.over_price) ?? -110 },
      { name: 'Under', point: total, price: num(row.under_price) ?? -110 },
    ];
  }
  return {
    sport: SPORT_SLUG[row.sport] || String(row.sport).toLowerCase(),
    home_team: row.home_team,
    away_team: row.away_team,
    game_date: row.game_date,
    commence_time: row.game_date,
    markets,
    total,
    spread,
    moneyline_home: mlH,
    moneyline_away: mlA,
  };
}

/** Price of a side from the built game. */
function priceForSide(game, side) {
  const m = game.markets || {};
  if (side === 'home_ml') return m.h2h?.find(o => o.name === game.home_team)?.price ?? null;
  if (side === 'away_ml') return m.h2h?.find(o => o.name === game.away_team)?.price ?? null;
  if (side === 'home_spread') return m.spreads?.find(o => o.name === game.home_team)?.price ?? -110;
  if (side === 'away_spread') return m.spreads?.find(o => o.name === game.away_team)?.price ?? -110;
  if (side === 'over' || side === 'under') return m.totals?.find(o => o.name === (side === 'over' ? 'Over' : 'Under'))?.price ?? -110;
  return null;
}

/** won, lost, push for a side against the final score. */
function gradeSide(side, game, homeScore, awayScore) {
  const h = Number(homeScore), a = Number(awayScore);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  const margin = h - a;
  if (side === 'home_ml') return margin > 0 ? 'won' : margin < 0 ? 'lost' : 'push';
  if (side === 'away_ml') return margin < 0 ? 'won' : margin > 0 ? 'lost' : 'push';
  if (side === 'home_spread' || side === 'away_spread') {
    const point = side === 'home_spread' ? game.spread : -game.spread;
    if (point == null || !Number.isFinite(point)) return null;
    const own = side === 'home_spread' ? margin : -margin;
    const cover = own + point;
    return cover > 0 ? 'won' : cover < 0 ? 'lost' : 'push';
  }
  if (side === 'over' || side === 'under') {
    if (game.total == null) return null;
    const diff = (h + a) - game.total;
    if (diff === 0) return 'push';
    return (side === 'over') === (diff > 0) ? 'won' : 'lost';
  }
  return null;
}

function unitsFor(outcome, price) {
  const p = Number(price);
  if (outcome === 'won') return Number.isFinite(p) && p !== 0 ? (p > 0 ? p / 100 : 100 / Math.abs(p)) : 0;
  if (outcome === 'lost') return -1;
  return 0;
}

function pickText(side, game) {
  if (side === 'home_ml') return `${game.home_team} ML`;
  if (side === 'away_ml') return `${game.away_team} ML`;
  if (side === 'home_spread') return `${game.home_team} ${game.spread > 0 ? '+' : ''}${game.spread}`;
  if (side === 'away_spread') return `${game.away_team} ${-game.spread > 0 ? '+' : ''}${-game.spread}`;
  if (side === 'over') return `Over ${game.total}`;
  if (side === 'under') return `Under ${game.total}`;
  return side;
}

/** July: frozen calculator, July multipliers, best calibrated side at 2pp. */
async function julyPick(real, game, asOfDate) {
  const calc = new JulyCalculator(asOfSupabase(real, asOfDate));
  calc._getCalibration = async () => ({ ...JULY_MULTIPLIERS });
  const edgeData = await calc.calculateEdge(game);
  if (!edgeData) return { edgeData: null, pick: null };
  const best = calc.pickBestSide(edgeData, { minEdgePp: 2 });
  if (!best) return { edgeData, pick: null };
  const pp = Math.round(best.signedEdge * 1000) / 10;
  return { edgeData, pick: { side: best.side, edgePp: pp, edgePpRaw: pp, tier: edgeTier(pp) } };
}

/** Current: live calculator, live band map, raw gate, price rails, headline side. */
async function currentPick(real, game, sportDisplay, asOfDate) {
  const calc = new LiveCalculator(asOfSupabase(real, asOfDate));
  let edgeData = await calc.calculateEdge(game);
  if (!edgeData) return { edgeData: null, pick: null };
  edgeData = await bandCalibration.applyToEdgeData(edgeData, sportDisplay);
  const best = calc.pickBestSide(edgeData, { minEdgePp: 2 });
  if (!best) return { edgeData, pick: null };
  const raw = edgeData.edgesRaw?.[best.side];
  const gate = edgeData.edgesPreBand?.[best.side] ?? best.signedEdge;
  if (raw == null || raw * 100 < 2 || gate * 100 < 2) return { edgeData, pick: null, gated: true };
  const pp = Math.round(best.signedEdge * 1000) / 10;
  const priced = pricePenaltyPp(pp, priceForSide(game, best.side));
  const published = priced.applied ? priced.edgePp : pp;
  return { edgeData, pick: { side: best.side, edgePp: published, edgePpRaw: Math.round(raw * 1000) / 10, tier: edgeTier(published) } };
}

const FORMULAS = { july: julyPick, current: (real, game, asOf, sport) => currentPick(real, game, sport, asOf) };

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Run the replay. Returns the summary; rows land in replay_picks.
 */
async function runReplay(supabase, { sport = 'MLB', days = 30, formulas = ['july', 'current'], runId = null, concurrency = 4, log = () => {} } = {}) {
  const started = Date.now();
  const run = runId || `replay_${sport}_${days}d_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const until = new Date(Date.now() - 4 * 3600 * 1000).toISOString();

  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('game_analysis')
      .select('game_key, sport, home_team, away_team, game_date, spread, total, moneyline_home, moneyline_away, spread_home_price, spread_away_price, over_price, under_price, edges, edges_raw, recommended_side')
      .eq('sport', sport).gte('game_date', since).lt('game_date', until)
      .order('game_date', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

  const { data: results, error: rErr } = await supabase
    .from('game_results')
    .select('home_team_name, away_team_name, home_score, away_score, date')
    .eq('sport', sport).eq('status', 'final')
    .gte('date', since.slice(0, 10)).lte('date', until.slice(0, 10));
  if (rErr) throw rErr;
  const resultKey = (h, a, d) => `${String(h).toLowerCase()}|${String(a).toLowerCase()}|${d}`;
  const byKey = new Map((results || []).map(r => [resultKey(r.home_team_name, r.away_team_name, r.date), r]));

  const games = rows.map(row => {
    const d = siteDate(row.game_date);
    return { row, game: gameFromAnalysis(row), asOf: d, result: byKey.get(resultKey(row.home_team, row.away_team, d)) || null };
  }).filter(g => g.result && g.result.home_score != null && g.game.markets.h2h);

  const summary = { run_id: run, sport, days, games_analyzed: rows.length, games_with_results: games.length, formulas: {} };
  for (const f of formulas) summary.formulas[f] = { picks: 0, won: 0, lost: 0, push: 0, units: 0, no_edge: 0, gated: 0, errors: 0, by_tier: {} };

  const picks = [];
  await mapPool(games, concurrency, async (g) => {
    for (const f of formulas) {
      const s = summary.formulas[f];
      try {
        const out = await FORMULAS[f](supabase, g.game, g.asOf, sport);
        if (!out.pick) { if (out.gated) s.gated++; else s.no_edge++; continue; }
        const outcome = gradeSide(out.pick.side, g.game, g.result.home_score, g.result.away_score);
        if (!outcome) { s.no_edge++; continue; }
        const price = priceForSide(g.game, out.pick.side);
        const units = unitsFor(outcome, price);
        s.picks++; s[outcome]++; s.units = Math.round((s.units + units) * 100) / 100;
        s.by_tier[out.pick.tier] = s.by_tier[out.pick.tier] || { n: 0, won: 0, lost: 0, units: 0 };
        const t = s.by_tier[out.pick.tier]; t.n++; if (outcome !== 'push') t[outcome]++; t.units = Math.round((t.units + units) * 100) / 100;
        picks.push({
          run_id: run, formula: f, sport, game_key: g.row.game_key, game_date: g.row.game_date,
          home_team: g.row.home_team, away_team: g.row.away_team,
          side: out.pick.side, pick: pickText(out.pick.side, g.game), edge_pp: out.pick.edgePp, edge_pp_raw: out.pick.edgePpRaw,
          tier: out.pick.tier, odds: price, outcome, units: Math.round(units * 100) / 100,
          home_score: g.result.home_score, away_score: g.result.away_score,
          details: { edges: out.edgeData?.edges ?? null, edges_raw: out.edgeData?.edgesRaw ?? null, home_prob: out.edgeData?.homeWinProb ?? null, implied_home: out.edgeData?.impliedHomeProb ?? null },
        });
      } catch (err) {
        s.errors++;
        log(`replay ${f} ${g.row.game_key}: ${err.message}`);
      }
    }
  });

  for (let i = 0; i < picks.length; i += 200) {
    const { error } = await supabase.from('replay_picks').upsert(picks.slice(i, i + 200), { onConflict: 'run_id,formula,game_key' });
    if (error) { summary.write_error = error.message; break; }
  }
  summary.picks_written = picks.length;
  summary.duration_ms = Date.now() - started;
  return summary;
}

module.exports = { runReplay, gameFromAnalysis, gradeSide, unitsFor, priceForSide, asOfSupabase, pickText, siteDate, JULY_MULTIPLIERS };
