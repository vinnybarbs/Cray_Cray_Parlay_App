/**
 * Band calibration: IDENTITY since 2026-09-21 (owner, directive 25,
 * "buckets not bands").
 *
 * History. From 2026-08-16 a per band map relabeled published claims
 * toward what each claim band had historically delivered, refit every
 * Monday (first edge_band_calibration on the k scaled claim, then from
 * 2026-08-31 edge_band_calibration_raw straight from the raw claim, with
 * a market dimension for MLB totals). On 2026-09-21 one refit doubled
 * the MLB 4-7 band center off nine days of a heater and the owner called
 * the whole layer for what it was: a label rule that moves the goal
 * posts and never changes which side we take or which picks publish.
 *
 * The rule now. The tier is the scored claim: the raw edge times the
 * sport's multiplier dial minus the price rails, and nothing else. The
 * bands are buckets the picks fall into, each with a floor in
 * bucket_targets (delivered pp over break even). A bucket under its
 * floor is a finding for the weekly scorecard and the next sweep's
 * target, fixed by turning a factor weight through the three tests,
 * never by a relabel.
 *
 * This module stays as the seam every caller already uses. It stashes
 * edgesPreBand (the publish gate reads it, directive 17) and marks the
 * source so a read shows the layer is identity. It reads no table.
 */

'use strict';

/**
 * Identity: the edges are the edges. edgesPreBand mirrors them for the
 * publish gate and the alt market chooser, which read the pre band
 * value by contract.
 */
async function applyToEdgeData(edgeData) {
  if (!edgeData) return edgeData;
  if (edgeData.edges && typeof edgeData.edges === 'object') {
    edgeData.edgesPreBand = { ...edgeData.edges };
  }
  edgeData.bandSource = 'identity';
  return edgeData;
}

module.exports = { applyToEdgeData };
