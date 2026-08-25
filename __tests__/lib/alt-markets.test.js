const { chooseAltMarkets, altSessionId, marketOf } = require('../../lib/services/alt-markets');

describe('marketOf', () => {
  test('classifies sides', () => {
    expect(marketOf('home_ml')).toBe('ml');
    expect(marketOf('away_spread')).toBe('spread');
    expect(marketOf('over')).toBe('total');
    expect(marketOf(null)).toBe(null);
  });
});

describe('chooseAltMarkets', () => {
  test('a spread clearing the gate spotlights when the headline is a moneyline', () => {
    const alts = chooseAltMarkets(
      { home_ml: 0.11, away_ml: -0.11, home_spread: 0.031, away_spread: -0.031, over: 0.005, under: -0.005 },
      'home_ml'
    );
    expect(alts).toEqual([{ side: 'home_spread', market: 'spread', preBandEdge: 0.031 }]);
  });

  test('spread and total can both spotlight on one game', () => {
    const alts = chooseAltMarkets(
      { home_ml: 0.09, home_spread: 0.025, away_spread: -0.02, over: 0.04, under: -0.04 },
      'home_ml'
    );
    expect(alts.map(a => a.market).sort()).toEqual(['spread', 'total']);
  });

  test('the headline market never spotlights itself', () => {
    const alts = chooseAltMarkets(
      { home_spread: 0.08, away_spread: -0.08, over: 0.01, under: -0.01, home_ml: 0.03 },
      'home_spread'
    );
    expect(alts).toEqual([]);
  });

  test('a moneyline never spotlights as an alt even with a spread headline', () => {
    const alts = chooseAltMarkets(
      { home_ml: 0.05, home_spread: 0.08, over: 0.001 },
      'home_spread'
    );
    expect(alts).toEqual([]);
  });

  test('below the 2pp gate nothing spotlights', () => {
    expect(chooseAltMarkets({ home_spread: 0.019, over: 0.0199 }, 'home_ml')).toEqual([]);
    expect(chooseAltMarkets(null, 'home_ml')).toEqual([]);
  });

  test('the better side of a market wins the spotlight', () => {
    const alts = chooseAltMarkets({ over: 0.03, under: 0.001, home_spread: -0.01 }, 'home_ml');
    expect(alts).toEqual([{ side: 'over', market: 'total', preBandEdge: 0.03 }]);
  });
});

describe('altSessionId', () => {
  test('one domain per market per day', () => {
    expect(altSessionId('Spread', '2026-08-24')).toBe('auto_digest_alt_spread_2026-08-24');
    expect(altSessionId('Total', '2026-08-24')).toBe('auto_digest_alt_total_2026-08-24');
  });
});
