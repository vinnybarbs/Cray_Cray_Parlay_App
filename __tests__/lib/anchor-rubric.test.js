// The 2026-09-08 anchor-era rubric: the learning loop's first weight
// changes since the market anchor shipped. Form is zeroed (anti-signal
// in every attribution reading), pitcher runs half weight while
// anchored (sign flipped once the market became the base), and the
// spread margin transform only prices half the model's disagreement
// with the market (the amplified 10pp+ tail delivered minus 2.0pp on
// its first anchor-era measurement).

const { EdgeCalculator } = require('../../lib/services/edge-calculator');

describe('_dampedModelMargin', () => {
  const calc = new EdgeCalculator({});
  const sigma = 4.0; // MLB

  test('anchored: only half the probability disagreement prices covers', () => {
    const full = calc._dampedModelMargin(0.62, null, sigma);
    const market = calc._dampedModelMargin(0.55, null, sigma);
    const damped = calc._dampedModelMargin(0.62, 0.55, sigma);
    expect(damped).toBeCloseTo(market + 0.5 * (full - market), 10);
    expect(Math.abs(damped - market)).toBeLessThan(Math.abs(full - market));
  });

  test('agreeing with the market changes nothing', () => {
    const damped = calc._dampedModelMargin(0.58, 0.58, sigma);
    const full = calc._dampedModelMargin(0.58, null, sigma);
    expect(damped).toBeCloseTo(full, 10);
  });

  test('unanchored games keep the full transform', () => {
    const full = calc._dampedModelMargin(0.66, null, sigma);
    expect(calc._dampedModelMargin(0.66, undefined, sigma)).toBeCloseTo(full, 10);
    expect(calc._dampedModelMargin(0.66, NaN, sigma)).toBeCloseTo(full, 10);
  });

  test('damping is symmetric for dogs', () => {
    const dampedFav = calc._dampedModelMargin(0.62, 0.55, sigma);
    const dampedDog = calc._dampedModelMargin(0.38, 0.45, sigma);
    expect(dampedFav).toBeCloseTo(-dampedDog, 10);
  });
});
