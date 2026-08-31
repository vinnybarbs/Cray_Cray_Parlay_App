// MLB venue up-weight, learning loop stage two (2026-08-31): venue's
// attribution slope cleared the promotion gate two consecutive Mondays
// (7.37 on n=129, then 4.54 on n=252), so MLB's delta weight moved one
// max step, 0.25 to 0.3125. Every other sport stays at 0.25, and the
// White Sox / Royals safety rails (±4pp cap, confidence taper) hold for
// everyone.

const { EdgeCalculator } = require('../../lib/services/edge-calculator');

describe('_venueSplitImpact per-sport weight', () => {
  const calc = new EdgeCalculator({});
  // 20+ game sample: taper is 1.0, so the weight reads directly.
  const delta = 0.10;
  const games = 25;

  test('MLB carries the stage two up-weight', () => {
    expect(calc._venueSplitImpact(delta, games, 'MLB')).toBeCloseTo(0.10 * 0.3125, 6);
  });

  test('other sports keep the original weight', () => {
    expect(calc._venueSplitImpact(delta, games, 'NFL')).toBeCloseTo(0.10 * 0.25, 6);
    expect(calc._venueSplitImpact(delta, games, 'NBA')).toBeCloseTo(0.10 * 0.25, 6);
    expect(calc._venueSplitImpact(delta, games)).toBeCloseTo(0.10 * 0.25, 6);
  });

  test('the ±4pp cap still binds above the up-weight', () => {
    expect(calc._venueSplitImpact(0.30, games, 'MLB')).toBeCloseTo(0.04, 6);
    expect(calc._venueSplitImpact(-0.30, games, 'MLB')).toBeCloseTo(-0.04, 6);
  });

  test('the confidence taper still applies under the up-weight', () => {
    // 10 games: confidence (10-5)/15 = 1/3.
    expect(calc._venueSplitImpact(delta, 10, 'MLB')).toBeCloseTo(0.10 * 0.3125 / 3, 6);
    expect(calc._venueSplitImpact(delta, 4, 'MLB')).toBe(0);
  });
});
