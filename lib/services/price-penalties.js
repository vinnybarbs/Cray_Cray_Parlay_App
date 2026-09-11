/**
 * Price penalties: the two price rails as pp adjustments on the dial board.
 *
 * Until 2026-09-10 the chalk fence (-150 or heavier never Sharp Take) and
 * the longshot ceiling (+300 or longer never above Lean) were label swaps
 * inside edgeTier. The owner retired label swaps ("doesn't matter what
 * label we give it, we score ourselves off pp ... we should be tweaking
 * pp not adjusting tier label by feel"), so each rail now DEDUCTS from the
 * claim and the tier falls out of the adjusted claim. The deduction is
 * visible in the published edge_pp, in the record, and on the dial board:
 *
 *   chalk_penalty_pp    (seed 3): deducted at -150 or heavier, flat.
 *   longshot_penalty_pp (seed 6): deducted at +300, growing with price in
 *                                 proportion (+600 deducts double, +1300
 *                                 deducts 26pp) so no name team at +1300
 *                                 lands at Lean no matter the claim.
 *
 * A penalty never turns a read into a fade: it floors at the 2pp Lean gate
 * (the price ate the edge, it did not reverse it), and it never touches a
 * Skip or Trap. Sport rows override the __all__ row like every dial.
 * Tennis at +251 stays a hard publish fence (directive 4), it is not a
 * penalty. Fail-soft: a dial read failure serves the code defaults.
 */

'use strict';

const CHALK_ODDS_FENCE = -150;
const LONGSHOT_ODDS_FLOOR = 300;
const DEFAULT_CHALK_PENALTY_PP = 3;
const DEFAULT_LONGSHOT_PENALTY_PP = 6;
const LEAN_FLOOR_PP = 2;
const DIAL_NAMES = ['chalk_penalty_pp', 'longshot_penalty_pp'];
const DIAL_TTL_MS = 10 * 60 * 1000;

let _dialCache = { at: 0, rows: null };

function parseOdds(americanOdds) {
  if (americanOdds == null) return null;
  const o = Number(String(americanOdds).replace(/[^0-9-]/g, ''));
  return Number.isFinite(o) && o !== 0 ? o : null;
}

/**
 * Pure: the claim after the price rails. Returns
 * { edgePp, penaltyPp, kind, applied, reason }.
 */
function pricePenaltyPp(edgePp, americanOdds, { chalkPp = DEFAULT_CHALK_PENALTY_PP, longshotPp = DEFAULT_LONGSHOT_PENALTY_PP } = {}) {
  const none = { edgePp, penaltyPp: 0, kind: null, applied: false, reason: null };
  const pp = Number(edgePp);
  if (!Number.isFinite(pp) || pp < LEAN_FLOOR_PP) return none;
  const o = parseOdds(americanOdds);
  if (o == null) return none;

  let kind = null;
  let penaltyPp = 0;
  if (o < 0 && o <= CHALK_ODDS_FENCE) {
    kind = 'chalk';
    penaltyPp = Number(chalkPp);
  } else if (o >= LONGSHOT_ODDS_FLOOR) {
    kind = 'longshot';
    penaltyPp = Number(longshotPp) * (o / LONGSHOT_ODDS_FLOOR);
  }
  if (!kind || !Number.isFinite(penaltyPp) || penaltyPp <= 0) return none;

  penaltyPp = Math.round(penaltyPp * 10) / 10;
  const adjusted = Math.round(Math.max(LEAN_FLOOR_PP, pp - penaltyPp) * 10) / 10;
  const priceText = o > 0 ? `+${o}` : String(o);
  if (adjusted === Math.round(pp * 10) / 10) {
    // The rail applies but the claim already sits at the Lean floor, so
    // nothing comes off. The marker still lands in the reasoning: the
    // directive 16 check reads every railed published row for it, and a
    // 2.0pp chalk Lean without one looked like a skipped rail (ops check
    // 2026-09-11, the UFC shaped hole that was not a hole).
    const label = kind === 'chalk' ? 'Chalk price' : 'Longshot price';
    return { edgePp, penaltyPp: 0, kind, applied: true, reason: `${label}: ${priceText} is railed, but the claim already sits at the ${LEAN_FLOOR_PP}pp Lean floor, so no deduction applies.` };
  }
  const reason = kind === 'chalk'
    ? `Chalk price: ${priceText} is ${CHALK_ODDS_FENCE} or heavier, so the claim is deducted ${penaltyPp}pp (${pp} to ${adjusted}); heavy chalk claimed edges measure as mostly vig.`
    : `Longshot price: ${priceText} is +${LONGSHOT_ODDS_FLOOR} or longer, so the claim is deducted ${penaltyPp}pp (${pp} to ${adjusted}); odds are a likelihood, not just a break even number.`;
  return { edgePp: adjusted, penaltyPp, kind, applied: true, reason };
}

/** The dialed penalties for a sport: sport row, then __all__, then default. */
async function pricePenaltyDials(supabase, sport) {
  const out = { chalkPp: DEFAULT_CHALK_PENALTY_PP, longshotPp: DEFAULT_LONGSHOT_PENALTY_PP };
  try {
    if (!_dialCache.rows || Date.now() - _dialCache.at > DIAL_TTL_MS) {
      const res = await supabase.from('sport_dials').select('sport, dial, value').in('dial', DIAL_NAMES);
      const rows = (res && Array.isArray(res.data) ? res.data : [])
        .map(r => ({ sport: r.sport, dial: r.dial, value: Number(r.value) }))
        .filter(r => Number.isFinite(r.value));
      _dialCache = { at: Date.now(), rows };
    }
    const pick = (dial) => {
      const s = _dialCache.rows.find(r => r.dial === dial && r.sport === sport);
      if (s) return s.value;
      const a = _dialCache.rows.find(r => r.dial === dial && r.sport === '__all__');
      return a ? a.value : null;
    };
    const c = pick('chalk_penalty_pp');
    const l = pick('longshot_penalty_pp');
    if (c != null) out.chalkPp = c;
    if (l != null) out.longshotPp = l;
  } catch { /* defaults */ }
  return out;
}

/** Dial-aware wrapper for the pipeline. Same return shape as pricePenaltyPp. */
async function applyPricePenalties(supabase, { sport, edgePp, odds }) {
  const dials = await pricePenaltyDials(supabase, sport);
  return pricePenaltyPp(edgePp, odds, dials);
}

function _resetDialCache() { _dialCache = { at: 0, rows: null }; }

module.exports = {
  pricePenaltyPp,
  pricePenaltyDials,
  applyPricePenalties,
  _resetDialCache,
  CHALK_ODDS_FENCE,
  LONGSHOT_ODDS_FLOOR,
  DEFAULT_CHALK_PENALTY_PP,
  DEFAULT_LONGSHOT_PENALTY_PP,
  LEAN_FLOOR_PP,
};
