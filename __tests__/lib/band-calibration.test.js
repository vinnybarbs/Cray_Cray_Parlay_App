const { applyToEdgeData } = require('../../lib/services/band-calibration');

// Directive 25 (owner 2026-09-21, buckets not bands): the band layer is
// identity. The tier is the scored claim, the bands are buckets with
// floors, and a bucket miss is fixed by a dial move, never a relabel.
describe('applyToEdgeData is identity', () => {
  test('positive and negative sides pass through untouched', async () => {
    const edgeData = {
      edge: 0.0829,
      edgeSide: 'home',
      edges: { home_ml: 0.0829, away_ml: -0.0829, home_spread: 0.0289, over: 0.12 },
      edgesRaw: { home_ml: 0.14, away_ml: -0.14 },
    };
    const out = await applyToEdgeData(edgeData, 'MLB');
    expect(out.edges.home_ml).toBe(0.0829);
    expect(out.edges.away_ml).toBe(-0.0829);
    expect(out.edges.home_spread).toBe(0.0289);
    expect(out.edges.over).toBe(0.12);
    expect(out.edge).toBe(0.0829);
  });

  test('edgesPreBand mirrors the edges for the publish gate', async () => {
    const out = await applyToEdgeData({ edge: 0.05, edges: { home_ml: 0.05, away_ml: -0.05 } });
    expect(out.edgesPreBand).toEqual({ home_ml: 0.05, away_ml: -0.05 });
    expect(out.edgesPreBand).not.toBe(out.edges);
  });

  test('marks the layer as identity so a read shows it', async () => {
    const out = await applyToEdgeData({ edge: 0.05, edges: { home_ml: 0.05 } }, 'NFL');
    expect(out.bandSource).toBe('identity');
  });

  test('every sport gets the same treatment', async () => {
    for (const sport of ['MLB', 'NFL', 'Tennis', 'UFC', '__all__', undefined]) {
      const out = await applyToEdgeData({ edge: 0.11, edges: { home_ml: 0.11 } }, sport);
      expect(out.edges.home_ml).toBe(0.11);
    }
  });

  test('null and edge-less inputs pass through', async () => {
    expect(await applyToEdgeData(null)).toBeNull();
    const out = await applyToEdgeData({ edge: 0.03 });
    expect(out.edgesPreBand).toBeUndefined();
    expect(out.bandSource).toBe('identity');
  });
});
