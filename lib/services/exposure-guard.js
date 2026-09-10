/**
 * Team exposure guard for bet-tier moneyline claims.
 *
 * The model's inputs move slowly, so a wrong opinion about one team gets
 * re-bet day after day: August 2026 saw nine Astros and four Rockies
 * bet-tier claims in three weeks, and the Rockies went 0-4. Picks on the
 * same team are the same claim resampled, not independent bets, so cold
 * streaks run far deeper than the naive record math implies.
 *
 * The guard: when a team's two most recent graded moneyline picks at bet
 * tiers (Sharp Take, Strong Play, Play) inside the last 7 days both
 * lost, that team's next moneyline claim is DEDUCTED exposure_guard_pp
 * (dial, default 2pp) and the tier falls out of the adjusted claim. It
 * used to demote the label one rung (owner approved 2026-08-21); the
 * owner moved it onto the pp scale on 2026-09-10 ("doesn't matter what
 * label we give it, we score ourselves off pp"), so the penalty is now
 * visible in the claim, in the record, and on the dial board. It clears
 * on its own the moment a pick on the team cashes or the losses age past
 * the window. Only bet-tier claims (4pp and up) are penalized: below that
 * the tiers are research labels, not bet signals. Fail-soft: any query
 * problem means no penalty.
 */

'use strict';

const WINDOW_DAYS = 7;
const CONSECUTIVE_LOSSES = 2;
const GRADED_TIERS = ['Sharp Take', 'Strong Play', 'Play'];
const BET_TIER_FLOOR_PP = 4;
const DEFAULT_PENALTY_PP = 2;
const DIAL_TTL_MS = 10 * 60 * 1000;

let _dialCache = { at: 0, bySport: null };

/**
 * Pure decision: rows are the team's graded ML picks, most recent first.
 * Penalize only when the window holds a full streak of recent losses.
 */
function shouldPenalize(rows) {
  if (!Array.isArray(rows) || rows.length < CONSECUTIVE_LOSSES) return false;
  return rows.slice(0, CONSECUTIVE_LOSSES).every(r => r?.actual_outcome === 'lost');
}

/** The dialed penalty for a sport: sport row, then __all__, then default. */
async function penaltyFor(supabase, sport) {
  try {
    if (!_dialCache.bySport || Date.now() - _dialCache.at > DIAL_TTL_MS) {
      const res = await supabase.from('sport_dials').select('sport, value').eq('dial', 'exposure_guard_pp');
      const bySport = new Map();
      for (const r of (res && Array.isArray(res.data) ? res.data : [])) {
        const v = Number(r.value);
        if (Number.isFinite(v)) bySport.set(r.sport, v);
      }
      _dialCache = { at: Date.now(), bySport };
    }
    const m = _dialCache.bySport;
    if (m.has(sport)) return m.get(sport);
    if (m.has('__all__')) return m.get('__all__');
  } catch { /* fall through to default */ }
  return DEFAULT_PENALTY_PP;
}

/**
 * Look up the team's recent graded moneyline record and deduct the dialed
 * penalty from the incoming claim when the streak holds.
 * Returns { edgePp, penaltyPp, applied, reason }.
 */
async function applyExposureGuard(supabase, { sport, team, edgePp }) {
  const pp = Number(edgePp);
  if (!Number.isFinite(pp) || pp < BET_TIER_FLOOR_PP || !team || !sport) {
    return { edgePp, penaltyPp: 0, applied: false, reason: null };
  }
  try {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
    const { data, error } = await supabase
      .from('ai_suggestions')
      .select('actual_outcome, game_date')
      .eq('sport', sport)
      .eq('bet_type', 'Moneyline')
      .in('tier', GRADED_TIERS)
      .in('actual_outcome', ['won', 'lost'])
      .is('voided_at', null)
      .ilike('pick', `${team} %`)
      .gte('game_date', since)
      .order('game_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(CONSECUTIVE_LOSSES);
    if (error || !shouldPenalize(data)) return { edgePp, penaltyPp: 0, applied: false, reason: null };
    const penaltyPp = await penaltyFor(supabase, sport);
    const adjusted = Math.round((pp - penaltyPp) * 10) / 10;
    return {
      edgePp: adjusted,
      penaltyPp,
      applied: true,
      reason: `Exposure guard: ${team} moneyline has lost ${CONSECUTIVE_LOSSES} straight graded picks this week, so this claim is deducted ${penaltyPp}pp (${pp} to ${adjusted}) until the team cashes or the window rolls.`,
    };
  } catch {
    return { edgePp, penaltyPp: 0, applied: false, reason: null };
  }
}

function _resetDialCache() { _dialCache = { at: 0, bySport: null }; }

module.exports = { applyExposureGuard, shouldPenalize, penaltyFor, _resetDialCache, WINDOW_DAYS, CONSECUTIVE_LOSSES, BET_TIER_FLOOR_PP, DEFAULT_PENALTY_PP };
