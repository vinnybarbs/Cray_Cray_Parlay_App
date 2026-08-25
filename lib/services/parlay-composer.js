/**
 * House parlay composition, hit-first (owner spec 2026-08-25).
 *
 * The old builder took the top of the pool by edge, which built parlays
 * out of the day's spiciest claims: highest variance exactly where the
 * product promise is the opposite. A parlay is a hit-rate product, the
 * owner's target is 70 percent over time, so composition now optimizes
 * probability of cashing:
 *
 *   2 leg: 1 Leg + the anchor
 *   3 leg: 2 Legs + the anchor
 *
 * where Legs are the 65 percent-and-up hit-probability sides and the
 * anchor is the SAFEST pick graded Play or better (highest model
 * probability, edge as the tiebreak), not the biggest edge. When the day
 * publishes no Play-or-better pick, the anchor slot falls back to
 * another Leg: an extra heavy favorite hurts the hit goal far less than
 * a coin-flip Lean. Leans enter only as a last-resort backfill so a thin
 * day still ships a product.
 *
 * Pure functions, the cron owns the queries.
 */

'use strict';

const ANCHOR_TIERS = new Set(['Play', 'Strong Play', 'Sharp Take']);

const num = (v) => (v == null ? null : Number(v));

// Safest first: model probability, then edge, both descending.
function bySafety(a, b) {
  const pa = num(a.model_prob) ?? num(a.implied_prob) ?? 0;
  const pb = num(b.model_prob) ?? num(b.implied_prob) ?? 0;
  if (pb !== pa) return pb - pa;
  return (num(b.edge_pp) ?? 0) - (num(a.edge_pp) ?? 0);
}

/**
 * Compose one parlay of `size` legs from a pool already deduped to one
 * row per game. Returns { rows, composition } or null when the pool
 * cannot fill the size. rows are ordered Legs first, anchor last.
 */
function composeParlay(pool, size) {
  const legs = (pool || []).filter((r) => r.tier === 'Leg').sort(bySafety);
  const anchors = (pool || []).filter((r) => ANCHOR_TIERS.has(r.tier)).sort(bySafety);
  const leans = (pool || [])
    .filter((r) => r.tier !== 'Leg' && !ANCHOR_TIERS.has(r.tier))
    .sort(bySafety);

  const anchor = anchors[0] || null;
  const chosen = legs.slice(0, anchor ? size - 1 : size);
  if (anchor) chosen.push(anchor);

  let composition = anchor
    ? `${Math.min(legs.length, size - 1)}_legs_plus_anchor`
    : 'all_legs';

  if (chosen.length < size) {
    const used = new Set(chosen.map((r) => r.id));
    const backfill = [...legs, ...anchors, ...leans].filter((r) => !used.has(r.id));
    chosen.push(...backfill.slice(0, size - chosen.length));
    composition = 'backfilled';
  }

  return chosen.length === size ? { rows: chosen, composition } : null;
}

module.exports = { composeParlay, ANCHOR_TIERS };
