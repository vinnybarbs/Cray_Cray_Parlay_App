/**
 * Per-band edge calibration, fit on PUBLISHED pick outcomes.
 *
 * The flat per-market multipliers (edge_calibration) are fit across all
 * graded reads, but the record only publishes the games where the model
 * most disagrees with the market, and that tail is where overclaiming
 * concentrates (winner's curse). Measured on 45 days of published picks
 * (2026-08-16): claimed 2-4pp delivered 4.1, claimed 4-7 delivered 0.02,
 * claimed 7-10 delivered 3.3, claimed 10+ delivered 13.0. So the size of
 * a claimed edge needs a second, band-aware correction that the flat k
 * cannot express.
 *
 * The mapping is piecewise linear through the fitted band centers stored
 * in edge_band_calibration (refit weekly by refresh_edge_band_calibration
 * with weighted isotonic pooling and 0.5 damping per step, so labels move
 * toward delivered reality gradually instead of cliffing overnight).
 * Interpolating between centers keeps the map monotone, which per-band
 * constant multipliers would not be at band boundaries.
 *
 * Only POSITIVE edges are mapped. Negative edges (trap reads) pass
 * through untouched: there is no published-outcome sample for fades and
 * the trap detector's thresholds were tuned on raw edges. Fail-soft: any
 * load error returns the identity mapping and the pipeline behaves
 * exactly as before this layer existed.
 */

'use strict';

const { supabase } = require('../middleware/supabaseAuth.js');

const CACHE_TTL_MS = 10 * 60 * 1000;

let _cache = { at: 0, points: null };

/**
 * Piecewise-linear interpolation through [{claimed, calibrated}] points
 * (sorted by claimed ascending, implicit origin at 0,0). Beyond the last
 * point the map extends along the last point's ratio so a monster edge
 * still scales instead of clamping.
 */
function interpolatePp(points, claimedPp) {
  if (!Array.isArray(points) || points.length === 0) return claimedPp;
  if (claimedPp <= 0) return claimedPp;
  let prev = { claimed: 0, calibrated: 0 };
  for (const pt of points) {
    if (claimedPp <= pt.claimed) {
      const span = pt.claimed - prev.claimed;
      if (span <= 0) return pt.calibrated;
      const t = (claimedPp - prev.claimed) / span;
      return prev.calibrated + t * (pt.calibrated - prev.calibrated);
    }
    prev = pt;
  }
  const last = points[points.length - 1];
  return last.claimed > 0 ? claimedPp * (last.calibrated / last.claimed) : claimedPp;
}

async function loadPoints() {
  if (_cache.points && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.points;
  try {
    const { data, error } = await supabase
      .from('edge_band_calibration')
      .select('claimed_center, calibrated_center')
      .order('claimed_center', { ascending: true });
    if (error || !data || data.length === 0) return _cache.points;
    const points = data.map((r) => ({
      claimed: Number(r.claimed_center),
      calibrated: Number(r.calibrated_center),
    })).filter((p) => Number.isFinite(p.claimed) && Number.isFinite(p.calibrated));
    if (points.length > 0) _cache = { at: Date.now(), points };
    return _cache.points;
  } catch {
    return _cache.points;
  }
}

/**
 * Map one signed edge FRACTION (not pp). Positive edges are calibrated,
 * everything else passes through.
 */
async function calibrateSignedEdge(signedEdge) {
  if (signedEdge == null || !Number.isFinite(Number(signedEdge)) || signedEdge <= 0) return signedEdge;
  const points = await loadPoints();
  if (!points) return signedEdge;
  return interpolatePp(points, signedEdge * 100) / 100;
}

/**
 * Calibrate every positive side in an edgeData result in place-safe copy
 * semantics: mutates the object it is given (the pipeline owns it) and
 * returns it. Handles the core calculator shape and the tennis/ufc/soccer
 * model shapes, all of which carry an `edges` dict of signed fractions
 * plus a top-line `edge`.
 */
async function applyToEdgeData(edgeData) {
  if (!edgeData) return edgeData;
  const points = await loadPoints();
  if (!points) return edgeData;
  // Preserve the pre-band claimed edges. The publish gate reads these so
  // calibration relabels picks without shrinking what publishes (owner:
  // everything graded keeps publishing, the research is the product).
  if (edgeData.edges && typeof edgeData.edges === 'object') {
    edgeData.edgesPreBand = { ...edgeData.edges };
  }
  if (edgeData.edges && typeof edgeData.edges === 'object') {
    for (const [side, v] of Object.entries(edgeData.edges)) {
      if (v != null && Number.isFinite(Number(v)) && v > 0) {
        edgeData.edges[side] = interpolatePp(points, v * 100) / 100;
      }
    }
  }
  if (edgeData.edge != null && Number.isFinite(Number(edgeData.edge)) && edgeData.edge > 0) {
    edgeData.edge = interpolatePp(points, edgeData.edge * 100) / 100;
  }
  return edgeData;
}

// Test seams.
function _resetCache() { _cache = { at: 0, points: null }; }
function _setPoints(points) { _cache = { at: Date.now(), points }; }

module.exports = { interpolatePp, calibrateSignedEdge, applyToEdgeData, _resetCache, _setPoints };
