/**
 * Cached edge_calibration multiplier lookup for the player-sport models,
 * which take a plain calibrationMultiplier number instead of reading the
 * table themselves (so they stay pure and testable without Supabase).
 *
 * Chain semantics: first key in the list that exists wins, then 1.
 * Callers pass sport-specific chains like ['UFC:ml', 'UFC']. Deliberately
 * never __global__: that k is fit on team-sport picks and says nothing
 * about a player-sport model.
 *
 * Fails open to 1: a table outage means edges go out uncalibrated, never
 * a stopped sweep. Same 10 minute TTL as the edge-calculator cache.
 */

'use strict';

const TTL_MS = 10 * 60 * 1000;
const _cache = new Map();

async function getCalibrationMultiplier(supabase, keys) {
  const cacheKey = keys.join('|');
  const hit = _cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value = 1;
  try {
    const { data, error } = await supabase
      .from('edge_calibration')
      .select('key, multiplier')
      .in('key', keys);
    if (!error && Array.isArray(data)) {
      const byKey = Object.fromEntries(data.map((r) => [r.key, Number(r.multiplier)]));
      for (const k of keys) {
        if (Number.isFinite(byKey[k])) { value = byKey[k]; break; }
      }
    }
  } catch { /* fail open */ }
  _cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** Test hook. */
function _resetCache() { _cache.clear(); }

module.exports = { getCalibrationMultiplier, _resetCache };
