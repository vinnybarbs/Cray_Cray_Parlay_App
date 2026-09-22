process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const { EdgeCalculator } = require('../../lib/services/edge-calculator');
const { mutedSides } = require('../../lib/services/publish-markets');

// The Yankees vs Rays read on 2026-09-22: Over 6.5 at 15pp with totals
// muted, Yankees -1.5 at 4.4pp open. The headline must be the spread.
const edgeData = {
  edges: { home_ml: 0.011, away_ml: -0.011, home_spread: 0.044, away_spread: -0.044, over: 0.15, under: -0.15 },
};

describe('pickBestSide with muted markets', () => {
  const calc = new EdgeCalculator({ from: () => ({ select: async () => ({ data: [], error: null }) }) });

  test('without an exclusion the muted total wins (the leak)', () => {
    expect(calc.pickBestSide(edgeData, { minEdgePp: -100 }).side).toBe('over');
  });

  test('with totals muted the headline is the best open market', () => {
    const best = calc.pickBestSide(edgeData, { minEdgePp: -100, excludeSides: mutedSides({ ml: 1, spread: 1, total: 0 }) });
    expect(best.side).toBe('home_spread');
    expect(best.signedEdge).toBeCloseTo(0.044, 6);
  });

  test('the spread to moneyline tiebreak never lands on a muted moneyline', () => {
    const tight = { edges: { home_ml: 0.04, home_spread: 0.045, over: 0.01 } };
    expect(calc.pickBestSide(tight, { minEdgePp: 0 }).side).toBe('home_ml');
    expect(calc.pickBestSide(tight, { minEdgePp: 0, excludeSides: new Set(['home_ml', 'away_ml']) }).side).toBe('home_spread');
  });

  test('every open side under the floor returns null even when a muted side clears it', () => {
    const only = { edges: { home_ml: 0.005, over: 0.12 } };
    expect(calc.pickBestSide(only, { minEdgePp: 2, excludeSides: new Set(['over', 'under']) })).toBeNull();
  });
});
