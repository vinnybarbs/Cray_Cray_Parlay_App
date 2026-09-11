/**
 * Change gate fingerprint helpers.
 *
 * The pre-analyze change gate hashes every prompt input and skips the
 * model call when nothing moved. MLB never skipped: same day boards tick
 * a cent or two every twenty minutes, so the odds fingerprint always
 * differed and edge and pick followed it (ops checks, sixteen reports,
 * PR 138 tally). Owner ruling 2026-09-11: quantize odds in the hash.
 * Moneylines round to the nearest 5 cents, spreads and totals to the
 * nearest half point, the edge and its probabilities to 1pp. A real
 * line move still re-narrates; a tick does not.
 */

'use strict';

function roundTo(v, step) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !(step > 0)) return v;
  return Math.round(n / step) * step;
}

function quantizeOdds(oddsCtx) {
  const o = oddsCtx || {};
  return {
    spread: roundTo(o.spread, 0.5),
    total: roundTo(o.total, 0.5),
    ml_home: roundTo(o.ml_home, 5),
    ml_away: roundTo(o.ml_away, 5),
  };
}

function quantizeEdge(edgeData) {
  if (!edgeData) return null;
  return {
    edge: roundTo(edgeData.edge, 0.01),
    side: edgeData.edgeSide,
    home: roundTo(edgeData.homeWinProb, 0.01),
    implied: roundTo(edgeData.impliedHomeProb, 0.01),
  };
}

module.exports = { roundTo, quantizeOdds, quantizeEdge };
