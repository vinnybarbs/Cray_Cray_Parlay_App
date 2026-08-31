const { interpolatePp, applyToEdgeData, _setPoints, _setRawPoints, _resetCache } = require('../../lib/services/band-calibration');

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

  test('stashes pre-band edges for the publish gate', async () => {
    _setPoints(SEED);
    const edgeData = { edge: 0.0829, edges: { home_ml: 0.0829, away_ml: -0.0829 } };
    const out = await applyToEdgeData(edgeData);
    expect(out.edgesPreBand.home_ml).toBeCloseTo(0.0829, 6);
    expect(out.edgesPreBand.away_ml).toBeCloseTo(-0.0829, 6);
    expect(out.edges.home_ml).not.toBeCloseTo(0.0829, 4);
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

  test('a sport uses its own map, an unfitted sport gets identity', async () => {
    _setPoints(SEED, 'MLB');
    const mlb = await applyToEdgeData({ edge: 0.0829, edges: { home_ml: 0.0829 } }, 'MLB');
    expect(mlb.edges.home_ml * 100).toBeCloseTo(5.8, 2);
    // NFL has no fitted rows: identity, never the pooled or MLB haircut.
    const nfl = await applyToEdgeData({ edge: 0.0829, edges: { home_ml: 0.0829 } }, 'NFL');
    expect(nfl.edges.home_ml * 100).toBeCloseTo(8.29, 5);
  });
});

// The raw band map (promoted 2026-08-31): one fit from RAW claimed pp to
// delivered pp replaces the flat-k-times-band double shrink for sports
// that have their own raw fit. The 2026-08-31 MLB fit.
const RAW_FIT = [
  { claimed: 2.97, calibrated: 1.07 },
  { claimed: 5.38, calibrated: 1.07 },
  { claimed: 8.65, calibrated: 5.7 },
  { claimed: 12.84, calibrated: 12.84 },
];

describe('applyToEdgeData raw band map', () => {
  afterEach(() => _resetCache());

  test('positive sides are recomputed from RAW edges, bypassing flat k', async () => {
    _setPoints(SEED, 'MLB');
    _setRawPoints(RAW_FIT, 'MLB');
    const edgeData = {
      edge: 0.0216, // raw 8.65 after the pinned 0.25 flat k
      edgeSide: 'home',
      edges: { home_ml: 0.0216, away_ml: -0.0216 },
      edgesRaw: { home_ml: 0.0865, away_ml: -0.0865 },
    };
    const out = await applyToEdgeData(edgeData, 'MLB');
    // Raw 8.65 maps to 5.70 delivered, not 2.16 double-shrunk.
    expect(out.edges.home_ml * 100).toBeCloseTo(5.7, 2);
    expect(out.edge * 100).toBeCloseTo(5.7, 2);
    expect(out.bandSource).toBe('raw');
  });

  test('the mapped value owns the publish gate', async () => {
    _setRawPoints(RAW_FIT, 'MLB');
    const out = await applyToEdgeData({
      edge: 0.0074, edgeSide: 'home',
      edges: { home_ml: 0.0074 },
      edgesRaw: { home_ml: 0.0297 },
    }, 'MLB');
    // Raw 2.97 delivers 1.07: below the 2pp gate, and edgesPreBand says so.
    expect(out.edgesPreBand.home_ml * 100).toBeCloseTo(1.07, 2);
  });

  test('a muted market (flat k 0) stays muted, raw claim or not', async () => {
    _setRawPoints(RAW_FIT, 'MLB');
    const out = await applyToEdgeData({
      edge: 0.0216, edgeSide: 'home',
      // Totals muted: flat k 0 leaves the k-scaled edge at 0 even though
      // the raw claim is huge. The raw map must not resurrect it.
      edges: { home_ml: 0.0216, over: 0 },
      edgesRaw: { home_ml: 0.0865, over: 0.167 },
    }, 'MLB');
    expect(out.edges.over).toBe(0);
    expect(out.edgesPreBand.over).toBe(0);
    expect(out.edges.home_ml * 100).toBeCloseTo(5.7, 2);
  });

  test('negative trap sides keep the flat-k value', async () => {
    _setRawPoints(RAW_FIT, 'MLB');
    const out = await applyToEdgeData({
      edge: 0.0216, edgeSide: 'home',
      edges: { home_ml: 0.0216, away_ml: -0.031 },
      edgesRaw: { home_ml: 0.0865, away_ml: -0.124 },
    }, 'MLB');
    expect(out.edges.away_ml).toBeCloseTo(-0.031, 6);
  });

  test('a monster raw claim clamps at the 15pp confidence bound', async () => {
    _setRawPoints(RAW_FIT, 'MLB');
    const out = await applyToEdgeData({
      edge: 0.06, edgeSide: 'home',
      edges: { home_ml: 0.06 },
      edgesRaw: { home_ml: 0.24 },
    }, 'MLB');
    expect(out.edges.home_ml).toBeCloseTo(0.15, 6);
  });

  test('a sport without a raw fit runs the legacy banded path', async () => {
    _setPoints(SEED, 'MLB');
    _setRawPoints(RAW_FIT, 'UFC'); // some OTHER sport has a raw fit
    const out = await applyToEdgeData({
      edge: 0.0829,
      edges: { home_ml: 0.0829 },
      edgesRaw: { home_ml: 0.19 },
    }, 'MLB');
    expect(out.edges.home_ml * 100).toBeCloseTo(5.8, 2);
    expect(out.bandSource).toBe('flat_k_banded');
    expect(out.edgesPreBand.home_ml).toBeCloseTo(0.0829, 6);
  });

  test('missing edgesRaw falls back to the legacy path', async () => {
    _setPoints(SEED, 'MLB');
    _setRawPoints(RAW_FIT, 'MLB');
    const out = await applyToEdgeData({ edge: 0.0829, edges: { home_ml: 0.0829 } }, 'MLB');
    expect(out.edges.home_ml * 100).toBeCloseTo(5.8, 2);
    expect(out.bandSource).toBe('flat_k_banded');
  });
});
