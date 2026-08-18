/**
 * Per-band edge calibration, fit on PUBLISHED pick outcomes, PER SPORT.
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
 * Sport independence (owner direction 2026-08-17): each sport's map is
 * fit on that sport's own published outcomes once it has a real sample,
 * with the pooled '__all__' map serving only as the prior until then.
 * Football must never inherit MLB's haircut history, and a sport whose
 * claims are honest must not be punished for another sport's overclaim.
 *
 * The mapping is piecewise linear through the fitted band centers stored
 * in edge_band_calibration (refit weekly by refresh_edge_band_calibration
 * with weighted isotonic pooling and 0.5 damping per step, so labels move
 * toward delivered reality gradually instead of cliffing).
 *
 * Only POSITIVE edges are mapped. Negative edges (trap reads) pass
 * through untouched. Fail-soft: any load error returns the identity
 * mapping and the pipeline behaves exactly as before this layer existed.
 */

'use strict';

const { supabase } = require('../middleware/supabaseAuth.js');

const CACHE_TTL_MS = 10 * 60 * 1000;
const POOLED = '__all__';

let _cache = { at: 0, bySport: null };

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

async function loadMaps() {
  if (_cache.bySport && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.bySport;
  try {
    const { data, error } = await supabase
      .from('edge_band_calibration')
      .select('sport, claimed_center, calibrated_center')
      .order('claimed_center', { ascending: true });
    if (error || !data || data.length === 0) return _cache.bySport;
    const bySport = new Map();
    for (const r of data) {
      const claimed = Number(r.claimed_center);
      const calibrated = Number(r.calibrated_center);
      if (!Number.isFinite(claimed) || !Number.isFinite(calibrated)) continue;
      const sport = r.sport || POOLED;
      if (!bySport.has(sport)) bySport.set(sport, []);
      bySport.get(sport).push({ claimed, calibrated });
    }
    if (bySport.size > 0) _cache = { at: Date.now(), bySport };
    return _cache.bySport;
  } catch {
    return _cache.bySport;
  }
}

// Sport-specific map when that sport has earned its own fit, pooled prior
// otherwise, null when nothing is loaded (identity behavior).
async function pointsFor(sport) {
  const maps = await loadMaps();
  if (!maps) return null;
  return maps.get(sport) || maps.get(POOLED) || null;
}

/**
 * Map one signed edge FRACTION (not pp). Positive edges are calibrated,
 * everything else passes through.
 */
async function calibrateSignedEdge(signedEdge, sport = POOLED) {
  if (signedEdge == null || !Number.isFinite(Number(signedEdge)) || signedEdge <= 0) return signedEdge;
  const points = await pointsFor(sport);
  if (!points) return signedEdge;
  return interpolatePp(points, signedEdge * 100) / 100;
}

/**
 * Calibrate every positive side in an edgeData result. Mutates the object
 * it is given (the pipeline owns it) and returns it. Handles the core
 * calculator shape and the tennis/ufc/soccer model shapes, all of which
 * carry an `edges` dict of signed fractions plus a top-line `edge`.
 */
async function applyToEdgeData(edgeData, sport = POOLED) {
  if (!edgeData) return edgeData;
  const points = await pointsFor(sport);
  if (!points) return edgeData;
  // Preserve the pre-band claimed edges. The publish gate reads these so
  // calibration relabels picks without shrinking what publishes (owner:
  // everything graded keeps publishing, the research is the product).
  if (edgeData.edges && typeof edgeData.edges === 'object') {
    edgeData.edgesPreBand = { ...edgeData.edges };
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
function _resetCache() { _cache = { at: 0, bySport: null }; }
function _setPoints(points, sport = POOLED) {
  if (points == null) { _cache = { at: Date.now(), bySport: null }; return; }
  if (!_cache.bySport) _cache = { at: Date.now(), bySport: new Map() };
  _cache.at = Date.now();
  _cache.bySport.set(sport, points);
}

module.exports = { interpolatePp, calibrateSignedEdge, applyToEdgeData, _resetCache, _setPoints };
