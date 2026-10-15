const { composeParlay, isHeavy, isModelNegative, impliedOf, HEAVY_IMPLIED } = require('../../lib/services/parlay-composer');

const leg = (id, prob) => ({ id, tier: 'Leg', model_prob: prob, odds: '-180', edge_pp: 0.5 });
const heavyFave = (id, odds, tier = 'Lean') => ({ id, tier, odds, model_prob: null, implied_prob: null, edge_pp: 1.5 });
const lean = (id, odds = '-136') => ({ id, tier: 'Lean', odds, model_prob: 0.55, edge_pp: 2.1 });

describe('isHeavy', () => {
  test('a Leg label always qualifies', () => {
    expect(isHeavy(leg('l1', 0.7))).toBe(true);
  });
  test('-186 or heavier qualifies whatever the tier', () => {
    expect(isHeavy(heavyFave('h1', '-186'))).toBe(true);
    expect(isHeavy(heavyFave('h2', '-250', 'Play'))).toBe(true);
    expect(isHeavy(heavyFave('h3', '-160'))).toBe(false);
  });
  test('a -136 Lean never qualifies', () => {
    expect(isHeavy(lean('x1'))).toBe(false);
  });
});

describe('impliedOf', () => {
  test('prefers stored implied, falls back to the price', () => {
    expect(impliedOf({ implied_prob: '0.68', odds: '-136' })).toBeCloseTo(0.68, 6);
    expect(impliedOf({ odds: '-200' })).toBeCloseTo(0.6667, 3);
    expect(impliedOf({ odds: '+150' })).toBeCloseTo(0.4, 6);
  });
  test('the heavy bar sits at about -186', () => {
    expect(impliedOf({ odds: '-186' })).toBeGreaterThanOrEqual(HEAVY_IMPLIED);
    expect(impliedOf({ odds: '-185' })).toBeLessThan(HEAVY_IMPLIED);
  });
});

describe('isModelNegative', () => {
  test('a heavy the model prices below fair is not parlay material (the Eala -3800 case)', () => {
    expect(isModelNegative({ tier: 'Leg', odds: '-3800', model_prob: 0.956, implied_prob: 0.969 })).toBe(true);
  });
  test('model at or above fair is fine, and no model read means no objection', () => {
    expect(isModelNegative({ tier: 'Leg', odds: '-620', model_prob: 0.87, implied_prob: 0.87 })).toBe(false);
    expect(isModelNegative({ tier: 'Lean', odds: '-250', model_prob: null, implied_prob: null })).toBe(false);
  });
});

describe('composeParlay', () => {
  test('model-negative heavies are excluded before ranking', () => {
    const eala = { id: 'neg', tier: 'Leg', odds: '-3800', model_prob: 0.956, implied_prob: 0.969, edge_pp: -1.3 };
    const pool = [eala, leg('l1', 0.72), heavyFave('h1', '-250')];
    const { rows } = composeParlay(pool, 2);
    expect(rows.map(r => r.id)).toEqual(['l1', 'h1']);
    // And when excluding it leaves the pool short, the day builds nothing.
    expect(composeParlay([eala, leg('l1', 0.72)], 2)).toBeNull();
  });

  test('builds only from heavy favorites, highest hit probability first', () => {
    const pool = [lean('x1'), leg('l1', 0.72), heavyFave('h1', '-250'), leg('l2', 0.66)];
    const { rows, composition } = composeParlay(pool, 2);
    expect(rows.map(r => r.id)).toEqual(['l1', 'h1']);
    expect(composition).toBe('heavy_only');
  });

  test('a board without enough heavy favorites builds NOTHING, never a Lean backfill', () => {
    expect(composeParlay([lean('x1'), lean('x2'), lean('x3')], 2)).toBeNull();
    expect(composeParlay([leg('l1', 0.7), lean('x1')], 2)).toBeNull();
  });

  test('3 leg needs three heavies', () => {
    const pool = [leg('l1', 0.72), leg('l2', 0.66), heavyFave('h1', '-200')];
    const { rows } = composeParlay(pool, 3);
    expect(rows).toHaveLength(3);
    expect(composeParlay(pool.slice(0, 2), 3)).toBeNull();
  });
});

describe('composeValueParlay (owner 2026-10-15, gimme plus value)', () => {
  const { composeValueParlay, isValuePick } = require('../../lib/services/parlay-composer');
  const dec = (o) => (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
  // Same math as the cron's combineLegs, enough for the floors.
  const combine = (legs) => {
    let d = 1, m = 1;
    for (const l of legs) { d *= dec(parseInt(l.odds, 10)); m *= Number(l.model_prob); }
    return { combinedDecimal: d, combinedOdds: d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)), evPct: Math.round((m * d - 1) * 1000) / 10 };
  };
  const gimme = (id, odds, p) => ({ id, tier: 'Leg', odds, model_prob: p, implied_prob: p - 0.01, edge_pp: 0.5 });
  const value = (id, tier, odds, p, edge) => ({ id, tier, odds, model_prob: p, implied_prob: p - edge / 100, edge_pp: edge });

  test('a gimme plus a Strong Play at positive EV and at least -125 builds', () => {
    const pool = [gimme('g1', '-500', 0.88), value('s1', 'Strong Play', '-140', 0.66, 8), value('p1', 'Play', '-150', 0.64, 5)];
    const out = composeValueParlay(pool, 2, { combine, minEvPct: 0, minDecimal: 1.8 });
    expect(out.rows.map(r => r.id)).toEqual(['g1', 's1']);
    expect(out.composition).toBe('gimme_plus_value');
    expect(out.combined.evPct).toBeGreaterThan(0);
  });

  test('two gimmes never make a slip without a value pick', () => {
    const out = composeValueParlay([gimme('g1', '-500', 0.88), gimme('g2', '-400', 0.85)], 2, { combine });
    expect(out.rows).toBeNull();
    expect(out.reason).toBe('no_value_pick');
  });

  test('a Lean is not a value pick', () => {
    expect(isValuePick(value('l1', 'Lean', '-120', 0.56, 2.5))).toBe(false);
    expect(isValuePick(value('s1', 'Strong Play', '-120', 0.62, 8))).toBe(true);
  });

  test('a slip that pays under the floor does not build', () => {
    const pool = [gimme('g1', '-2000', 0.97), value('s1', 'Strong Play', '-300', 0.83, 7.5)];
    const out = composeValueParlay(pool, 2, { combine, minEvPct: 0, minDecimal: 1.8 });
    expect(out.rows).toBeNull();
    expect(out.reason).toMatch(/^pays_below_floor/);
  });

  test('negative claimed EV does not build', () => {
    const pool = [gimme('g1', '-500', 0.80), value('p1', 'Play', '+120', 0.46, 0.5)];
    const out = composeValueParlay(pool, 2, { combine, minEvPct: 0, minDecimal: 1.8 });
    expect(out.rows).toBeNull();
    expect(out.reason).toMatch(/^ev_below_floor/);
  });

  test('three legs are two gimmes plus one value pick', () => {
    const pool = [gimme('g1', '-900', 0.93), gimme('g2', '-700', 0.91), value('s1', 'Sharp Take', '+110', 0.58, 10)];
    const out = composeValueParlay(pool, 3, { combine, minEvPct: 0, minDecimal: 1.8 });
    expect(out.rows.map(r => r.id)).toEqual(['g1', 'g2', 's1']);
  });
});
