/**
 * Rule gates: the lookback engine's selection rules, run on every published
 * pick and logged with a verdict, never changing what publishes while the
 * rule is in shadow mode.
 *
 * Owner 2026-10-01 approved the four MLB rules from the first lookback run
 * (TrapHawk Lookback Engine and Business Plan, build_queue 68) as shadow
 * gates: "They log only." A rule lives in `rule_gates` (sport, market, side,
 * rule_key, params, mode) and every evaluation lands in `rule_gate_log`
 * (pass or hold with the inputs it saw). The scorecard view
 * `rule_gate_scorecard` joins the log to the graded ledger so each rule
 * earns or loses its promotion to live on 100 picks per verdict. A mute is
 * not an answer (AGENTS.md): each rule names what separates a cell's
 * winners from its losers.
 *
 *   starter_required     MLB ml and spread: the Probable starters factor is
 *                        on the read (without it ML favorites went 11-13
 *                        -6.7u, -1.5 favorites 9-22 -11.2u).
 *   starter_gap_025      MLB ml favorites: the pick side starter's ERA is at
 *                        least 0.25 better than the opponent's (62-25 +13.9u
 *                        over a 1.0 gap, the 0.25 rule keeps 121 at +14.2u
 *                        and drops 55 at -8.3u).
 *   light_favorite_rail  MLB ml priced -115 to +110: the pick'em band went
 *                        11-24 -13.6u, negative in both halves.
 *   rl_favorite_rule     MLB -1.5 favorites: the pitcher factor is present
 *                        and the model's own moneyline claim is under 5pp
 *                        (5pp plus claims 34-50 -13.8u, 2 to 5pp 26-27 +6.3u).
 *   rl_dog_prob_floor    MLB +1.5 dogs: model cover probability at least
 *                        0.65 (65 to 75 went 41-12 +10.7u, 55 to 65 22-20).
 *
 * The evaluator is pure. The loader reads rule_gates with a ten minute
 * cache and falls back to the seeded rules so a board outage still logs.
 * Fail soft everywhere: a gate failure never blocks a publish.
 */

'use strict';

const RULES_TTL_MS = 10 * 60 * 1000;
const STARTER_FACTOR = 'Probable starters';

/** The seeded rules, mirrored so the evaluator runs when the table is unreachable. */
const DEFAULT_RULES = [
  { sport: 'MLB', market: 'any', side: 'any', rule_key: 'starter_required', params: { markets: ['ml', 'spread'] }, mode: 'shadow' },
  { sport: 'MLB', market: 'ml', side: 'favorite', rule_key: 'starter_gap_025', params: { min_gap: 0.25 }, mode: 'shadow' },
  { sport: 'MLB', market: 'ml', side: 'any', rule_key: 'light_favorite_rail', params: { lo: -115, hi: 110 }, mode: 'shadow' },
  { sport: 'MLB', market: 'spread', side: 'favorite', rule_key: 'rl_favorite_rule', params: { max_ml_claim_pp: 5 }, mode: 'shadow' },
  { sport: 'MLB', market: 'spread', side: 'underdog', rule_key: 'rl_dog_prob_floor', params: { min_prob: 0.65 }, mode: 'shadow' },
];

let _cache = { at: 0, rows: null };

function parseOdds(odds) {
  if (odds == null) return null;
  const o = Number(String(odds).replace(/[^0-9-]/g, ''));
  return Number.isFinite(o) && o !== 0 ? o : null;
}

function marketOf(side) {
  if (side === 'home_ml' || side === 'away_ml') return 'ml';
  if (side === 'home_spread' || side === 'away_spread') return 'spread';
  if (side === 'over' || side === 'under') return 'total';
  return null;
}

/** Starter ERAs for the pick side and its opponent, from the factor row. */
function startersFor(edgeData, side) {
  const adj = (edgeData?.adjustments || []).find(a => a && a.factor === STARTER_FACTOR);
  if (!adj) return { present: false, pickEra: null, oppEra: null, gap: null };
  let homeEra = Number(adj.homeEra), awayEra = Number(adj.awayEra);
  if (!Number.isFinite(homeEra) || !Number.isFinite(awayEra)) {
    // Older rows carry the ERAs only in the detail text: "Away (3.10 ERA) at Home (4.55 ERA)".
    const m = /\(([\d.]+) ERA\) at .*\(([\d.]+) ERA\)/.exec(String(adj.detail || ''));
    awayEra = m ? Number(m[1]) : NaN;
    homeEra = m ? Number(m[2]) : NaN;
  }
  if (!Number.isFinite(homeEra) || !Number.isFinite(awayEra)) return { present: true, pickEra: null, oppEra: null, gap: null };
  const pickIsHome = side.startsWith('home');
  const pickEra = pickIsHome ? homeEra : awayEra;
  const oppEra = pickIsHome ? awayEra : homeEra;
  return { present: true, pickEra, oppEra, gap: Math.round((oppEra - pickEra) * 100) / 100 };
}

/**
 * Pure: everything a rule can look at, from the publish block's scope.
 * Returns null for a side no rule covers (totals, draws).
 */
function pickContext({ sport, side, point, odds, edgeData }) {
  const market = marketOf(side);
  if (!market || market === 'total') return null;
  const price = parseOdds(odds);
  let role = null;
  if (market === 'ml') role = price == null ? null : (price < 0 ? 'favorite' : 'underdog');
  if (market === 'spread') role = point == null ? null : (Number(point) < 0 ? 'favorite' : 'underdog');
  const teamMl = side.startsWith('home') ? 'home_ml' : 'away_ml';
  const mlClaim = edgeData?.edgesRaw?.[teamMl];
  const coverProb = edgeData?.coverProbs?.[side];
  return {
    sport, side, market, role, price,
    point: point == null ? null : Number(point),
    ml_claim_pp: mlClaim == null ? null : Math.round(mlClaim * 1000) / 10,
    cover_prob: coverProb == null ? null : Number(coverProb),
    starters: startersFor(edgeData, side),
  };
}

const CHECKS = {
  starter_required(ctx, p) {
    const markets = Array.isArray(p.markets) ? p.markets : ['ml', 'spread'];
    if (!markets.includes(ctx.market)) return null;
    return ctx.starters.present
      ? { verdict: 'pass', reason: 'Probable starters factor on the read' }
      : { verdict: 'hold', reason: 'no Probable starters factor on the read' };
  },
  starter_gap_025(ctx, p) {
    if (!ctx.starters.present || ctx.starters.gap == null) return null;
    const min = Number(p.min_gap ?? 0.25);
    return ctx.starters.gap >= min
      ? { verdict: 'pass', reason: `pick side starter ERA gap ${ctx.starters.gap} meets ${min}` }
      : { verdict: 'hold', reason: `pick side starter ERA gap ${ctx.starters.gap} under ${min}` };
  },
  light_favorite_rail(ctx, p) {
    if (ctx.price == null) return null;
    const lo = Number(p.lo ?? -115), hi = Number(p.hi ?? 110);
    const inBand = ctx.price >= lo && ctx.price <= hi;
    return inBand
      ? { verdict: 'hold', reason: `price ${ctx.price} sits in the ${lo} to +${hi} band` }
      : { verdict: 'pass', reason: `price ${ctx.price} outside the ${lo} to +${hi} band` };
  },
  rl_favorite_rule(ctx, p) {
    const max = Number(p.max_ml_claim_pp ?? 5);
    if (!ctx.starters.present) return { verdict: 'hold', reason: 'run line favorite without the Probable starters factor' };
    if (ctx.ml_claim_pp == null) return { verdict: 'hold', reason: 'run line favorite with no moneyline claim to check' };
    return ctx.ml_claim_pp < max
      ? { verdict: 'pass', reason: `moneyline claim ${ctx.ml_claim_pp}pp under ${max}pp with starters on the read` }
      : { verdict: 'hold', reason: `moneyline claim ${ctx.ml_claim_pp}pp at or over ${max}pp` };
  },
  rl_dog_prob_floor(ctx, p) {
    const min = Number(p.min_prob ?? 0.65);
    if (ctx.cover_prob == null) return { verdict: 'hold', reason: 'no model cover probability on the read' };
    return ctx.cover_prob >= min
      ? { verdict: 'pass', reason: `model cover probability ${ctx.cover_prob.toFixed(3)} meets ${min}` }
      : { verdict: 'hold', reason: `model cover probability ${ctx.cover_prob.toFixed(3)} under ${min}` };
  },
};

function ruleApplies(rule, ctx) {
  if (rule.mode === 'off') return false;
  if (rule.sport !== ctx.sport) return false;
  if (rule.market !== 'any' && rule.market !== ctx.market) return false;
  if (rule.side !== 'any' && rule.side !== ctx.role) return false;
  return typeof CHECKS[rule.rule_key] === 'function';
}

/**
 * Pure: evaluate every applicable rule. Returns
 * [{ rule_key, mode, verdict, reason, inputs }]. A rule whose inputs do
 * not apply (a gap rule with no starters) is left out, the starter rule
 * already records that case.
 */
function evaluateRuleGates(rules, ctx) {
  if (!ctx) return [];
  const out = [];
  for (const rule of rules || []) {
    if (!ruleApplies(rule, ctx)) continue;
    const r = CHECKS[rule.rule_key](ctx, rule.params || {});
    if (!r) continue;
    out.push({
      rule_key: rule.rule_key,
      mode: rule.mode || 'shadow',
      verdict: r.verdict,
      reason: r.reason,
      inputs: {
        price: ctx.price, point: ctx.point, role: ctx.role, market: ctx.market,
        ml_claim_pp: ctx.ml_claim_pp, cover_prob: ctx.cover_prob,
        starters: ctx.starters.present ? { pick_era: ctx.starters.pickEra, opp_era: ctx.starters.oppEra, gap: ctx.starters.gap } : null,
        params: rule.params || {},
      },
    });
  }
  return out;
}

/** The rules for a sport: table rows (cached ten minutes), else the seeds. */
async function loadRuleGates(supabase, sport) {
  try {
    if (!_cache.rows || Date.now() - _cache.at > RULES_TTL_MS) {
      const res = await supabase.from('rule_gates').select('sport, market, side, rule_key, params, mode').neq('mode', 'off');
      if (res && Array.isArray(res.data)) _cache = { at: Date.now(), rows: res.data };
    }
  } catch { /* seeds */ }
  const rows = _cache.rows || DEFAULT_RULES;
  return rows.filter(r => r.sport === sport);
}

/**
 * Pipeline entry: evaluate and log for one published pick. Shadow rules
 * never change the publish. Returns the evaluations (empty when nothing
 * applied). Never throws.
 */
async function runRuleGates(supabase, { sport, game, sessionId, pick, betType, side, point, odds, edgeData, tier, edgePp, log = console.log }) {
  try {
    const rules = await loadRuleGates(supabase, sport);
    if (!rules.length) return [];
    const ctx = pickContext({ sport, side, point, odds, edgeData });
    const results = evaluateRuleGates(rules, ctx);
    if (!results.length) return [];
    const rows = results.map(r => ({
      session_id: sessionId,
      game_key: game.game_key,
      sport,
      home_team: game.home_team,
      away_team: game.away_team,
      game_date: game.game_date || game.commence_time || null,
      bet_type: betType,
      side,
      pick,
      odds: odds == null ? null : String(odds),
      tier: tier || null,
      edge_pp: edgePp == null ? null : Number(edgePp),
      rule_key: r.rule_key,
      mode: r.mode,
      verdict: r.verdict,
      reason: r.reason,
      inputs: r.inputs,
      logged_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('rule_gate_log').upsert(rows, { onConflict: 'session_id,game_key,rule_key' });
    if (error) log(`  Rule gate log failed for ${game.game_key}: ${error.message}`);
    const holds = results.filter(r => r.verdict === 'hold');
    if (holds.length) log(`  🧪 Shadow gate hold on ${pick}: ${holds.map(h => `${h.rule_key} (${h.reason})`).join(', ')}`);
    return results;
  } catch (e) {
    log(`  Rule gates skipped for ${game?.game_key}: ${e.message}`);
    return [];
  }
}

function _resetRuleCache() { _cache = { at: 0, rows: null }; }

module.exports = { DEFAULT_RULES, pickContext, evaluateRuleGates, loadRuleGates, runRuleGates, startersFor, _resetRuleCache };
