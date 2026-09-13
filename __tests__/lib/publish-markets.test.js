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
