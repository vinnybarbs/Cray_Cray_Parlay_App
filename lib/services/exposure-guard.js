/**
 * Team exposure guard for bet-tier moneyline claims.
 *
 * The model's inputs move slowly, so a wrong opinion about one team gets
 * re-bet day after day: August 2026 saw nine Astros and four Rockies
 * bet-tier claims in three weeks, and the Rockies went 0-4. Picks on the
 * same team are the same claim resampled, not independent bets, so cold
 * streaks run far deeper than the naive record math implies.
 *
 * The guard: when a team's two most recent graded moneyline picks at
 * published tiers (Sharp Take, Strong Play, Play) inside the last 7 days
 * both lost, that team's next moneyline claim is demoted one rung on the
 * ladder. The demotion clears on its own the moment a pick on the team
 * cashes or the losses age past the window (owner approved 2026-08-21).
 *
 * Only Sharp Take and Strong Play are ever demoted: below that the tiers
 * are research labels, not bet signals, and the record keeps publishing.
 * Fail-soft: any query problem means no demotion.
 */

'use strict';

const WINDOW_DAYS = 7;
const CONSECUTIVE_LOSSES = 2;
const GRADED_TIERS = ['Sharp Take', 'Strong Play', 'Play'];
const DEMOTABLE = new Set(['Sharp Take', 'Strong Play']);

const LADDER_DOWN = {
  'Sharp Take': 'Strong Play',
  'Strong Play': 'Play',
  'Play': 'Lean',
};

/** One rung down the ladder; tiers off the ladder pass through unchanged. */
function demoteTier(tier) {
  return LADDER_DOWN[tier] || tier;
}

/**
 * Pure decision: rows are the team's graded ML picks, most recent first.
 * Demote only when the window holds a full streak of recent losses.
 */
function shouldDemote(rows) {
  if (!Array.isArray(rows) || rows.length < CONSECUTIVE_LOSSES) return false;
  return rows.slice(0, CONSECUTIVE_LOSSES).every(r => r?.actual_outcome === 'lost');
}

/**
 * Look up the team's recent graded moneyline record and decide whether the
 * incoming tier should be demoted. Returns { tier, demoted, reason }.
 */
async function applyExposureGuard(supabase, { sport, team, tier }) {
  if (!DEMOTABLE.has(tier) || !team || !sport) {
    return { tier, demoted: false, reason: null };
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
    if (error || !shouldDemote(data)) return { tier, demoted: false, reason: null };
    const demoted = demoteTier(tier);
    return {
      tier: demoted,
      demoted: true,
      reason: `Exposure guard: ${team} moneyline has lost ${CONSECUTIVE_LOSSES} straight graded picks this week, so this claim publishes one tier down (${tier} to ${demoted}) until the team cashes or the window rolls.`,
    };
  } catch {
    return { tier, demoted: false, reason: null };
  }
}

module.exports = { applyExposureGuard, shouldDemote, demoteTier, WINDOW_DAYS, CONSECUTIVE_LOSSES };
