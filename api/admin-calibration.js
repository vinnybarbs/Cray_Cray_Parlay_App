// Admin: the current calibration state behind every grade (owner request
// 2026-08-25: "I want to know what goes into each grade"). Read-only.
//
// A published tier is produced by this pipeline, in order:
//   1. The sport model prices each side (factors for team sports, market
//      consensus plus Elo for tennis, consensus for UFC) into a raw edge
//      versus the devigged price.
//   2. The flat-k multiplier (edge_calibration, refit Mondays on settled
//      picks since the process-break floor, clamped 0.25 to 1.2) scales
//      the raw edge by how much of past claims actually delivered.
//   3. Per-band calibration (edge_band_calibration, per sport) maps the
//      scaled claim to what that claim band historically delivered.
//   4. The tier ladder labels the calibrated pp, with the Sharp Take
//      chalk fence dropping 10pp+ claims at -150 or heavier one rung.
// Publication gates on the PRE-band edge (2pp) so calibration relabels
// without shrinking what publishes.

const { requireAdmin, getSupabase } = require('./admin-dashboard');

const LADDER = [
  { tier: 'Sharp Take', rule: 'calibrated 10pp or more, and lighter than -150 (heavier chalk drops to Strong Play, the fence)' },
  { tier: 'Strong Play', rule: 'calibrated 7 to 10pp, plus fenced 10pp+ chalk' },
  { tier: 'Play', rule: 'calibrated 4 to 7pp' },
  { tier: 'Lean', rule: 'calibrated 2 to 4pp, plus published picks whose calibrated pp fell under 2 (the ladder floor)' },
  { tier: 'Skip', rule: 'calibrated -2 to +2pp, the noise band, display only' },
  { tier: 'Trap', rule: 'calibrated -2pp or worse on a side the casual bettor is drawn to (lure signals), published as a fade call' },
  { tier: 'Leg', rule: 'model probability 65% or better to win with no betting edge, a gimme, tracked for parlays and never in the pick record' },
];

module.exports = async function adminCalibration(req, res) {
  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });
  const adminUser = await requireAdmin(req, res, supabase);
  if (!adminUser) return;

  try {
    const [multRes, bandRes, factorRes] = await Promise.all([
      supabase.from('edge_calibration')
        .select('key, multiplier, measured_k, sample_n, source, updated_at')
        .order('key'),
      supabase.from('edge_band_calibration')
        .select('sport, band, claimed_center, calibrated_center, sample_n, fitted_at')
        .order('sport').order('band'),
      supabase.rpc('factor_attribution'),
    ]);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ladder: LADDER,
      multipliers: multRes.data || [],
      multipliersError: multRes.error?.message || null,
      bands: bandRes.data || [],
      bandsError: bandRes.error?.message || null,
      // Factor attribution: read-only stage one of the learning loop,
      // MLB since the process-break floor. Slope reads: about 1 is sized
      // right, above 1 underweighted, near 0 priced in, negative
      // anti-signal. Thin samples (under 25) mean read nothing.
      factors: factorRes.data || [],
      factorsError: factorRes.error?.message || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
