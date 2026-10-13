const { MODELS, thinkingOff, narrationModelForTier, estimateCost } = require('../../lib/services/claude.js');
const { narrationTierFor } = require('../../api/cron/pre-analyze-games.js');

describe('narration model split (build_queue 91)', () => {
  test('Play and above plus Traps narrate on Sonnet 5.5', () => {
    for (const t of ['Play', 'Strong Play', 'Sharp Take', 'Trap']) {
      expect(narrationModelForTier(t)).toBe('claude-sonnet-5-5');
    }
  });

  test('Lean, Leg and Skip narrate on Haiku 5.5', () => {
    for (const t of ['Lean', 'Leg', 'Skip']) {
      expect(narrationModelForTier(t)).toBe('claude-haiku-5-5');
    }
    expect(MODELS.NARRATION_SMALL).toBe('claude-haiku-5-5');
  });

  test('thinking off uses the param each model accepts', () => {
    expect(thinkingOff('claude-sonnet-5-5')).toEqual({ type: 'between_tools' });
    expect(thinkingOff('claude-haiku-5-5')).toEqual({ type: 'disabled' });
    expect(thinkingOff('claude-sonnet-5')).toEqual({ type: 'disabled' });
    expect(thinkingOff('claude-haiku-4-5')).toBeNull();
  });

  test('cost logs Sonnet at the legacy rate and Haiku 5.5 at its own', () => {
    expect(estimateCost('claude-sonnet-5-5', 1e6, 1e6)).toBeCloseTo(18, 6);
    expect(estimateCost('claude-haiku-5-5', 1e6, 1e6)).toBeCloseTo(0.6, 6);
  });
});

describe('narrationTierFor', () => {
  const pick = { recommended_side: 'home_ml', signedEdge: 0.05 };

  test('a trap call narrates as Trap whatever the pick', () => {
    expect(narrationTierFor({ mathPick: pick, edgeData: {}, trapCalls: [{ side: 'away_ml' }] })).toBe('Trap');
  });

  test('the pp band of the scored claim once the raw gate clears', () => {
    const tier = (raw, scored) => narrationTierFor({
      mathPick: pick, trapCalls: [],
      edgeData: { edgesRaw: { home_ml: raw }, edges: { home_ml: scored } },
    });
    expect(tier(0.03, 0.03)).toBe('Lean');
    expect(tier(0.06, 0.05)).toBe('Play');
    expect(tier(0.09, 0.08)).toBe('Strong Play');
    expect(tier(0.12, 0.11)).toBe('Sharp Take');
    // Scaled under 2pp still publishes at the Lean floor.
    expect(tier(0.08, 0.01)).toBe('Lean');
  });

  test('a read under the raw gate is a Leg at 65 percent, else Skip', () => {
    const base = { mathPick: pick, trapCalls: [] };
    expect(narrationTierFor({ ...base, edgeData: { edgesRaw: { home_ml: 0.015 }, homeWinProb: 0.7 } })).toBe('Leg');
    expect(narrationTierFor({ ...base, edgeData: { edgesRaw: { home_ml: 0.015 }, homeWinProb: 0.55, awayWinProb: 0.45 } })).toBe('Skip');
    expect(narrationTierFor({ mathPick: null, trapCalls: [], edgeData: null })).toBe('Skip');
  });
});
