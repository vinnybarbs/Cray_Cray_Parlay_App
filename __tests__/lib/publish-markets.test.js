'use strict';

const pm = require('../../lib/services/publish-markets.js');
const { EdgeCalculator } = require('../../lib/services/edge-calculator.js');

describe('publish markets: per sport and market dials replace the shadow list', () => {
  beforeEach(() => pm._resetCache());

  test('marketOfSide maps every side key, the draw is a moneyline side', () => {
    expect(pm.marketOfSide('home_ml')).toBe('ml');
    expect(pm.marketOfSide('draw')).toBe('ml');
    expect(pm.marketOfSide('away_spread')).toBe('spread');
    expect(pm.marketOfSide('under')).toBe('total');
    expect(pm.marketOfSide('nonsense')).toBeNull();
    expect(pm.marketOfSide(null)).toBeNull();
  });

  test('a shadow sport with no rows publishes nothing; a live sport with no rows publishes everything', () => {
    expect(pm.flagsFromRows([], 'NCAAF')).toEqual({ ml: 0, spread: 0, total: 0 });
    expect(pm.flagsFromRows([], 'MLB')).toEqual({ ml: 1, spread: 1, total: 1 });
  });

  test('a sport row opens one market of a shadow sport (NCAAF moneylines live, spreads withheld)', () => {
    const rows = [{ sport: 'NCAAF', dial: 'publish_ml', value: 1 }, { sport: 'NCAAF', dial: 'publish_spread', value: 0 }, { sport: 'NCAAF', dial: 'publish_total', value: 0 }];
    expect(pm.flagsFromRows(rows, 'NCAAF')).toEqual({ ml: 1, spread: 0, total: 0 });
  });

  test('the __all__ row never opens a shadow sport by itself', () => {
    const rows = [{ sport: '__all__', dial: 'publish_ml', value: 1 }];
    expect(pm.flagsFromRows(rows, 'EPL').ml).toBe(0);
    expect(pm.flagsFromRows(rows, 'NFL').ml).toBe(1);
  });

  test('marketPublishOpen and sportIsShadow read the board and fail closed for shadow sports', async () => {
    const rows = [{ sport: 'NCAAF', dial: 'publish_ml', value: 1 }];
    const sb = { from: () => ({ select: () => ({ in: async () => ({ data: rows }) }) }) };
    expect(await pm.marketPublishOpen(sb, 'NCAAF', 'home_ml')).toBe(true);
    expect(await pm.marketPublishOpen(sb, 'NCAAF', 'home_spread')).toBe(false);
    expect(await pm.sportIsShadow(sb, 'NCAAF')).toBe(false);
    expect(await pm.sportIsShadow(sb, 'EPL')).toBe(true);
    pm._resetCache();
    const down = { from: () => { throw new Error('down'); } };
    expect(await pm.marketPublishOpen(down, 'NCAAF', 'home_ml')).toBe(false);
    expect(await pm.marketPublishOpen(down, 'MLB', 'home_ml')).toBe(true);
  });

  test('publishFlagsAll covers the code shadow list plus every sport with a row', async () => {
    const rows = [{ sport: 'NFL', dial: 'publish_total', value: 0 }];
    const sb = { from: () => ({ select: () => ({ in: async () => ({ data: rows }) }) }) };
    const all = await pm.publishFlagsAll(sb);
    expect(all.NFL).toEqual({ ml: 1, spread: 1, total: 0 });
    expect(all.NCAAF).toEqual({ ml: 0, spread: 0, total: 0 });
  });
});

describe('home margin shift: a negative shift lowers every home cover probability', () => {
  const calc = new EdgeCalculator({});
  test('at a pick em margin, -0.5 runs on a -1.5 line moves the cover probability down, +1.5 line too', () => {
    const base = calc._homeCoverProb(-1.5, 0.4, 4.0, 0);
    const shifted = calc._homeCoverProb(-1.5, 0.4, 4.0, -0.5);
    expect(shifted).toBeLessThan(base);
    const dogBase = calc._homeCoverProb(1.5, -0.4, 4.0, 0);
    const dogShifted = calc._homeCoverProb(1.5, -0.4, 4.0, -0.5);
    expect(dogShifted).toBeLessThan(dogBase);
    expect(calc._homeCoverProb(-1.5, 0.4, 4.0, 'junk')).toBeCloseTo(base, 12);
  });
});

describe('shadow narration: a whole-sport shadow read needs no Claude call', () => {
  test('carries the math pick, the three largest factors, zero tokens and the shadow model tag', () => {
    const r = pm.shadowNarration(
      { recommended_pick: 'Michigan Wolverines ML +170', recommended_side: 'home_ml', signedEdge: 0.025 },
      { adjustments: [
        { factor: 'Program strength, home', impact: 0.032 },
        { factor: 'Injury impact (Michigan Wolverines)', impact: -0.008 },
        { factor: 'Rest', impact: 0.004 },
        { factor: 'Weather', impact: 0.001 },
        { factor: 'junk', impact: 'x' },
      ] });
    expect(r.recommended_pick).toBe('Michigan Wolverines ML +170');
    expect(r.recommended_side).toBe('home_ml');
    expect(r.key_factors).toEqual(['Program strength, home +3.2pp', 'Injury impact (Michigan Wolverines) -0.8pp', 'Rest +0.4pp']);
    expect(r.model_used).toBe('shadow-silent');
    expect(r.prompt_tokens).toBe(0);
    expect(r.completion_tokens).toBe(0);
    expect(r.analysis_snippet).toMatch(/Shadow read/);
  });
  test('no pick and no factors still returns a complete result', () => {
    const r = pm.shadowNarration(null, null);
    expect(r.recommended_pick).toBeNull();
    expect(r.key_factors).toEqual([]);
  });
});

// 2026-09-21 leak: with the multiplier at 1 a muted total became the
// headline read on eleven MLB games and blocked the moneyline. A muted
// market's sides are skipped for the headline; a whole-sport shadow
// keeps every side so its reads still show on the board.
describe('mutedSides', () => {
  const { mutedSides } = require('../../lib/services/publish-markets');

  test('a muted total hides over and under only', () => {
    const s = mutedSides({ ml: 1, spread: 1, total: 0 });
    expect([...s].sort()).toEqual(['over', 'under']);
  });

  test('a muted spread hides both spread sides', () => {
    const s = mutedSides({ ml: 1, spread: 0, total: 1 });
    expect([...s].sort()).toEqual(['away_spread', 'home_spread']);
  });

  test('a whole-sport shadow hides nothing, its reads stay visible', () => {
    expect(mutedSides({ ml: 0, spread: 0, total: 0 }).size).toBe(0);
  });

  test('every market open hides nothing', () => {
    expect(mutedSides({ ml: 1, spread: 1, total: 1 }).size).toBe(0);
    expect(mutedSides(null).size).toBe(0);
  });
});
