// The NCAAF program-strength prior (CFBD build, 2026-09-05): the
// owner's eye encoded. A powerhouse-vs-noname gap argues a small,
// capped, named factor off the market anchor, never a fabricated
// blowout edge.

const { EdgeCalculator } = require('../../lib/services/edge-calculator');

describe('_strengthGapImpact', () => {
  const calc = new EdgeCalculator({});

  test('0.1pp per strength point, signed', () => {
    expect(calc._strengthGapImpact(10)).toBeCloseTo(0.010, 6);
    expect(calc._strengthGapImpact(-10)).toBeCloseTo(-0.010, 6);
  });

  test('the Ohio State vs New Mexico State gap argues 3.8pp, and 40+ caps at 4pp', () => {
    expect(calc._strengthGapImpact(38.2)).toBeCloseTo(0.0382, 6);
    expect(calc._strengthGapImpact(45)).toBeCloseTo(0.04, 6);
    expect(calc._strengthGapImpact(-50)).toBeCloseTo(-0.04, 6);
  });

  test('missing data argues nothing', () => {
    expect(calc._strengthGapImpact(null)).toBe(0);
    expect(calc._strengthGapImpact(undefined)).toBe(0);
  });
});

describe('_programStrengthAdjustment name matching', () => {
  const calc = new EdgeCalculator({});
  calc._strengthCache = {
    at: Date.now(),
    rows: [
      { team: 'Miami', strength: 15.5, conference: 'ACC' },
      { team: 'Miami (OH)', strength: -5.9, conference: 'Mid-American' },
      { team: 'Ohio State', strength: 24.1, conference: 'Big Ten' },
      { team: 'New Mexico State', strength: -14.2, conference: 'Conference USA' },
    ],
  };

  test('longest prefix wins: Miami (OH) RedHawks is not the Hurricanes', async () => {
    const adj = await calc._programStrengthAdjustment('Miami (OH) RedHawks', 'Miami Hurricanes');
    expect(adj.impact).toBeCloseTo(calc._strengthGapImpact(-5.9 - 15.5), 6);
    expect(adj.detail).toContain('Miami (OH)');
  });

  test('the powerhouse gap is sized and named', async () => {
    const adj = await calc._programStrengthAdjustment('Ohio State Buckeyes', 'New Mexico State Aggies');
    expect(adj.impact).toBeCloseTo(0.0383, 6);
    expect(adj.factor).toBe('Program strength (home)');
  });

  test('an unmatched side (FCS opponent) argues nothing', async () => {
    expect(await calc._programStrengthAdjustment('Ohio State Buckeyes', 'Youngstown State Penguins')).toBeNull();
  });
});
