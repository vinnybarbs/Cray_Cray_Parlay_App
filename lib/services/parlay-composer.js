/**
 * House parlay composition, heavy favorites only (owner spec 2026-08-26,
 * replacing the 08-25 legs-plus-anchor rule after one day: the anchor
 * fallback shipped Lean combos at 27 to 43 percent to hit, and the owner
 * called them what they were).
 *
 * A parlay is a hit-rate product with a 70 percent target. Every
 * component must be a heavy favorite:
 *
 *   - a Leg-label pick (the gimme tier, model 65 percent or better), or
 *   - a very heavy market favorite: implied probability 65 percent or
 *     better at its price (-186 or heavier raw), whatever its tier.
 *
 * There is NO backfill. A board without enough heavy favorites builds
 * nothing, because a coin-flip ticket sold as a parlay poisons the
 * record the product is judged on. Components are ranked by their
 * probability of hitting (model read when stored, implied otherwise).
 *
 * Pure functions, the cron owns the queries.
 */

'use strict';

// -186 or heavier: raw implied at -186 is 65.0 percent.
const HEAVY_IMPLIED = 0.65;

const num = (v) => (v == null ? null : Number(v));

/** Raw implied probability from the row's American odds string. */
function impliedOf(row) {
  const stored = num(row.implied_prob);
  if (stored != null && Number.isFinite(stored)) return stored;
  const n = parseInt(row.odds, 10);
  if (!Number.isFinite(n) || n === 0) return null;
  return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
}

/** Probability of hitting, for ranking: the model read when stored. */
function hitProbOf(row) {
  const model = num(row.model_prob);
  if (model != null && Number.isFinite(model)) return model;
  return impliedOf(row) ?? 0;
}

function isHeavy(row) {
  if (!row) return false;
  if (row.tier === 'Leg') return true;
  const implied = impliedOf(row);
  return implied != null && implied >= HEAVY_IMPLIED;
}

/** Fair (devigged) probability, same semantics as the cron's combineLegs:
 *  the stored devigged number when the pick carries one, else a standard
 *  two-way margin stripped off the price. */
function fairOf(row) {
  const stored = num(row.implied_prob);
  if (stored != null && Number.isFinite(stored)) return stored;
  const n = parseInt(row.odds, 10);
  if (!Number.isFinite(n) || n === 0) return null;
  const raw = n < 0 ? -n / (-n + 100) : 100 / (n + 100);
  return raw * 0.955;
}

/** A heavy the MODEL actively dislikes (model read below the fair price)
 *  is not parlay material, however chalky the price. Ranking by hit
 *  probability alone let a -3800 the model read 1.3pp under fair anchor
 *  both 2026-09-02 tickets and drag one to a negative combined edge
 *  (owner report). No model read means no objection. */
function isModelNegative(row) {
  const model = num(row.model_prob);
  const fair = fairOf(row);
  return model != null && Number.isFinite(model) && fair != null && model < fair;
}

/**
 * Compose one parlay of `size` legs from a pool already deduped to one
 * row per game. Returns { rows, composition } or null when the board
 * lacks enough heavy favorites, which is a legitimate no-build day.
 */
function composeParlay(pool, size) {
  const heavies = (pool || [])
    .filter(isHeavy)
    .filter((r) => !isModelNegative(r))
    .sort((a, b) => hitProbOf(b) - hitProbOf(a));
  if (heavies.length < size) return null;
  return { rows: heavies.slice(0, size), composition: 'heavy_only' };
}

module.exports = { composeParlay, isHeavy, isModelNegative, impliedOf, hitProbOf, HEAVY_IMPLIED };
