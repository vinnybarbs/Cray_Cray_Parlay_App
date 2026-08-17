const { interpolatePp, applyToEdgeData, _setPoints, _resetCache } = require('../../lib/services/band-calibration');

// The seed fit from 2026-08-16 published history (damped 0.5 from claimed
// centers toward weighted-isotonic delivered): claimed 2.89 -> 2.44,
// 5.18 -> 3.59, 8.29 -> 5.80, 13.48 -> 13.24.
const SEED = [
  { claimed: 2.89, calibrated: 2.44 },
  { claimed: 5.18, calibrated: 3.59 },
  { claimed: 8.29, calibrated: 5.8 },
  { claimed: 13.48, calibrated: 13.24 },
];

describe('interpolatePp', () => {
  test('maps band centers exactly', () => {
    expect(interpolatePp(SEED, 2.89)).toBeCloseTo(2.44, 5);
    expect(interpolatePp(SEED, 8.29)).toBeCloseTo(5.8, 5);
    expect(interpolatePp(SEED, 13.48)).toBeCloseTo(13.24, 5);
  });

  test('interpolates linearly between centers', () => {
    const mid = interpolatePp(SEED, (5.18 + 8.29) / 2);
    expect(mid).toBeGreaterThan(3.59);
    expect(mid).toBeLessThan(5.8);
  });

  test('anchors at the origin below the first center', () => {
    expect(interpolatePp(SEED, 0)).toBe(0);
    const low = interpolatePp(SEED, 1.4);
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(2.44);
  });

  test('extends by ratio beyond the last center', () => {
    const big = interpolatePp(SEED, 20);
    expect(big).toBeCloseTo(20 * (13.24 / 13.48), 5);
  });

  test('is monotone over the whole positive range', () => {
    let prev = -1;
    for (let pp = 0; pp <= 30; pp += 0.1) {
      const v = interpolatePp(SEED, pp);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  test('identity on empty points', () => {
    expect(interpolatePp([], 7.5)).toBe(7.5);
    expect(interpolatePp(null, 7.5)).toBe(7.5);
  });
});

describe('applyToEdgeData', () => {
  afterEach(() => _resetCache());

  test('calibrates positive sides, leaves negative sides raw', async () => {
    _setPoints(SEED);
    const edgeData = {
      edge: 0.0829,
      edgeSide: 'home_ml',
      edges: { home_ml: 0.0829, away_ml: -0.0829, home_spread: 0.0289 },
    };
    const out = await applyToEdgeData(edgeData);
    expect(out.edges.home_ml * 100).toBeCloseTo(5.8, 2);
    expect(out.edges.away_ml * 100).toBeCloseTo(-8.29, 5);
    expect(out.edges.home_spread * 100).toBeCloseTo(2.44, 2);
    expect(out.edge * 100).toBeCloseTo(5.8, 2);
  });

  test('identity when no points are loaded', async () => {
    _resetCache();
    _setPoints(null);
    const edgeData = { edge: 0.1, edges: { home_ml: 0.1 } };
    const out = await applyToEdgeData(edgeData);
    expect(out.edges.home_ml).toBe(0.1);
  });

  test('null edgeData passes through', async () => {
    _setPoints(SEED);
    expect(await applyToEdgeData(null)).toBeNull();
  });
});
