const { composeParlay } = require('../../lib/services/parlay-composer');

const leg = (id, prob) => ({ id, tier: 'Leg', model_prob: prob, edge_pp: 0.5 });
const play = (id, prob, edge, tier = 'Play') => ({ id, tier, model_prob: prob, edge_pp: edge });
const lean = (id, prob) => ({ id, tier: 'Lean', model_prob: prob, edge_pp: 2.1 });

describe('composeParlay', () => {
  test('2 leg is one Leg plus the anchor, anchor last', () => {
    const pool = [leg('l1', 0.72), leg('l2', 0.66), play('p1', 0.58, 4.2)];
    const { rows, composition } = composeParlay(pool, 2);
    expect(rows.map(r => r.id)).toEqual(['l1', 'p1']);
    expect(composition).toBe('1_legs_plus_anchor');
  });

  test('3 leg is two Legs plus the anchor', () => {
    const pool = [leg('l1', 0.72), leg('l2', 0.66), leg('l3', 0.65), play('p1', 0.58, 4.2)];
    const { rows } = composeParlay(pool, 3);
    expect(rows.map(r => r.id)).toEqual(['l1', 'l2', 'p1']);
  });

  test('the anchor is the SAFEST Play or better, not the biggest edge', () => {
    const pool = [leg('l1', 0.72), play('spicy', 0.52, 9.9, 'Sharp Take'), play('safe', 0.61, 4.0)];
    const { rows } = composeParlay(pool, 2);
    expect(rows.map(r => r.id)).toEqual(['l1', 'safe']);
  });

  test('no Play or better falls back to all Legs, never a Lean', () => {
    const pool = [leg('l1', 0.72), leg('l2', 0.66), lean('x1', 0.53)];
    const { rows, composition } = composeParlay(pool, 2);
    expect(rows.map(r => r.id)).toEqual(['l1', 'l2']);
    expect(composition).toBe('all_legs');
  });

  test('a short leg pool backfills with the safest remainder', () => {
    const pool = [leg('l1', 0.72), play('p1', 0.60, 4.0), lean('x1', 0.53)];
    const { rows, composition } = composeParlay(pool, 3);
    expect(rows.map(r => r.id).sort()).toEqual(['l1', 'p1', 'x1']);
    expect(composition).toBe('backfilled');
  });

  test('an unfillable size returns null', () => {
    expect(composeParlay([leg('l1', 0.7)], 2)).toBeNull();
    expect(composeParlay([], 2)).toBeNull();
  });
});
