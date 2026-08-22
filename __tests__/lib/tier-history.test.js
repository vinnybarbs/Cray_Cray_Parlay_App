const { withTierHistory, historyEntry } = require('../../lib/services/tier-history');

describe('withTierHistory', () => {
  test('first publish seeds a single-entry history', () => {
    const h = withTierHistory(null, null, { tier: 'Play', at: 't1' });
    expect(h).toEqual([{ tier: 'Play', at: 't1' }]);
  });

  test('same tier writes nothing', () => {
    expect(withTierHistory('Play', [{ tier: 'Play', at: 't1' }], { tier: 'Play', at: 't2' })).toBeNull();
    expect(withTierHistory('Play', null, { tier: 'Play', at: 't2' })).toBeNull();
  });

  test('a promotion appends to the existing path', () => {
    const h = withTierHistory('Strong Play',
      [{ tier: 'Strong Play', at: 't1' }],
      { tier: 'Sharp Take', at: 't2' });
    expect(h.map(e => e.tier)).toEqual(['Strong Play', 'Sharp Take']);
  });

  test('a legacy row with no history gets seeded with its prior tier', () => {
    const h = withTierHistory('Sharp Take', null, { tier: 'Strong Play', at: 't2' });
    expect(h).toEqual([
      { tier: 'Sharp Take', at: null },
      { tier: 'Strong Play', at: 't2' },
    ]);
  });

  test('missing entry or tier is a no-op', () => {
    expect(withTierHistory('Play', [], null)).toBeNull();
    expect(withTierHistory('Play', [], { at: 't2' })).toBeNull();
  });
});

describe('historyEntry', () => {
  test('carries tier, odds, edge and a timestamp', () => {
    const e = historyEntry('Sharp Take', '-115', 11);
    expect(e.tier).toBe('Sharp Take');
    expect(e.odds).toBe('-115');
    expect(e.edge_pp).toBe(11);
    expect(typeof e.at).toBe('string');
  });
});
