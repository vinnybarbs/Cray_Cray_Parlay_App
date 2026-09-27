// The frontend mirror of the price penalties must agree with the backend
// to the tenth, or the board would show one tier and the record another.

const path = require('path');
const fs = require('fs');

// src/lib/tiers.js is an ES module; evaluate it as CommonJS for the test.
function loadTiers() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'tiers.js'), 'utf8')
    .replace(/^export /gm, '');
  const m = { exports: {} };
  const fn = new Function('module', src + '\nmodule.exports = { edgeTier, pricePenaltyPp, priceAdjustedPp, finalPpFor, livePpFor, pickSideKey, edgePpForSide, lockOddsFor };');
  fn(m);
  return m.exports;
}

const backend = require('../../lib/services/price-penalties');
const grader = require('../../lib/services/pick-grader');

describe('frontend price penalty mirror', () => {
  const ui = loadTiers();
  const cases = [[12, '-160'], [12, '-150'], [12, '-149'], [9, '+300'], [15, '+450'], [15, '+1300'], [2.5, '-200'], [4, '+1300'], [2.0, '-410'], [1, '+1300'], [-5, '-200'], [12, null]];
  test.each(cases)('pp %s at %s', (pp, odds) => {
    const b = backend.pricePenaltyPp(pp, odds);
    const f = ui.pricePenaltyPp(pp, odds);
    expect(f.edgePp).toBe(b.edgePp);
    expect(f.penaltyPp).toBe(b.penaltyPp);
    expect(f.kind).toBe(b.kind);
    expect(ui.edgeTier(f.edgePp).label).toBe(grader.edgeTier(b.edgePp) ?? '-');
  });

  test('finalPpFor prefers the published claim and never re-penalizes it', () => {
    const game = { edges: { home_ml: 0.12 }, recommended_side: 'home_ml', recommended_odds: '-200', published_pick: { edge_pp: 9.6 } };
    expect(ui.finalPpFor(game)).toBe(9.6);
    delete game.published_pick;
    expect(ui.finalPpFor(game)).toBe(9);
  });

  // Owner 2026-09-27: an NFL Lean published three days out drifted to a
  // 0.0pp live read. The tile scored the published row, the Research modal
  // scored the live row and said Skip. Both numbers exist on purpose and
  // each has one name.
  test('livePpFor is the drifted read, finalPpFor stays the published claim', () => {
    const game = { edges: { away_ml: 0.0001 }, recommended_side: 'away_ml', recommended_odds: '+114', published_pick: { edge_pp: 3.1, pick: 'Tennessee Titans ML +114' } };
    expect(ui.finalPpFor(game)).toBe(3.1);
    expect(ui.livePpFor(game)).toBe(0);
    expect(ui.edgeTier(ui.livePpFor(game)).label).toBe('Skip');
    expect(ui.edgeTier(ui.finalPpFor(game)).label).toBe('Lean');
  });

  test('pickSideKey ignores the price and the line, keeps the market', () => {
    expect(ui.pickSideKey('Tampa Bay Rays ML +109')).toBe(ui.pickSideKey('Tampa Bay Rays ML +106'));
    expect(ui.pickSideKey('Cleveland Browns +2.5')).not.toBe(ui.pickSideKey('Cleveland Browns ML +120'));
    expect(ui.pickSideKey('Green Bay Packers ML -290')).not.toBe(ui.pickSideKey('Atlanta Falcons ML +195'));
    expect(ui.pickSideKey(null)).toBeNull();
  });
});
