/**
 * Spotlight lane for the non-headline markets (owner approved 2026-08-24).
 *
 * The board publishes ONE headline pick per game, the best edge across
 * all markets, which means a spread or total that clears the publish
 * gate on its own merits lives unseen inside the market tabs whenever
 * the moneyline edge is bigger. This helper names the alternates that
 * deserve their own published row: for each market group other than the
 * headline pick's, the best side whose PRE-band edge clears the same
 * 2pp gate the headline uses.
 *
 * The rows publish into their own session domains
 * (auto_digest_alt_spread_ / auto_digest_alt_total_), grade under their
 * bet type, count in the record per bet type, and ride the same
 * tier-entry alerts as everything else.
 */

'use strict';

const GATE = 0.02;
const GROUPS = {
  spread: ['home_spread', 'away_spread'],
  total: ['over', 'under'],
  ml: ['home_ml', 'away_ml'],
};

function marketOf(side) {
  if (!side) return null;
  if (side.endsWith('_spread')) return 'spread';
  if (side === 'over' || side === 'under') return 'total';
  return 'ml';
}

/**
 * Pure: returns [{ side, market, preBandEdge }] for each non-headline
 * market whose best side clears the gate. edgesPreBand is the pre-band
 * (post flat-k) edge map the publish gate itself uses.
 */
function chooseAltMarkets(edgesPreBand, headlineSide) {
  if (!edgesPreBand) return [];
  const headlineMarket = marketOf(headlineSide);
  const out = [];
  for (const [market, sides] of Object.entries(GROUPS)) {
    if (market === headlineMarket || market === 'ml') continue;
    let best = null;
    for (const side of sides) {
      const e = edgesPreBand[side];
      if (typeof e === 'number' && e >= GATE && (!best || e > best.preBandEdge)) {
        best = { side, market, preBandEdge: e };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

/** Session id for an alt row: one domain per market per site day. */
function altSessionId(betType, day) {
  return `auto_digest_alt_${String(betType).toLowerCase()}_${day}`;
}

module.exports = { chooseAltMarkets, altSessionId, marketOf };
