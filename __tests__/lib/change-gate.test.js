// Odds quantization in the change gate hash (owner ruling 2026-09-11):
// a cent tick is not a change, a half point is.

const { quantizeOdds, quantizeEdge, roundTo } = require('../../lib/services/change-gate');

describe('quantizeOdds', () => {
  test('moneylines round to 5 cents, lines to a half point', () => {
    expect(quantizeOdds({ spread: -1.5, total: 8.5, ml_home: -113, ml_away: 104 }))
      .toEqual({ spread: -1.5, total: 8.5, ml_home: -115, ml_away: 105 });
  });
  test('a two cent tick hashes the same, a real move does not', () => {
    const a = quantizeOdds({ spread: -1.5, total: 8.5, ml_home: -111, ml_away: 101 });
    const b = quantizeOdds({ spread: -1.5, total: 8.5, ml_home: -112, ml_away: 102 });
    const c = quantizeOdds({ spread: -1.5, total: 9, ml_home: -112, ml_away: 102 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });
  test('missing values stay null', () => {
    const q = quantizeOdds({ spread: null, total: undefined, ml_home: -110, ml_away: null });
    expect(q.spread).toBeNull();
    expect(q.total).toBeNull();
    expect(q.ml_home).toBe(-110);
    expect(q.ml_away).toBeNull();
    expect(roundTo('x', 5)).toBe('x');
  });
});

describe('quantizeEdge', () => {
  test('edge and probabilities round to 1pp', () => {
    expect(quantizeEdge({ edge: 0.0834, edgeSide: 'home_ml', homeWinProb: 0.6149, impliedHomeProb: 0.5311 }))
      .toEqual({ edge: 0.08, side: 'home_ml', home: 0.61, implied: 0.53 });
    expect(quantizeEdge(null)).toBeNull();
  });
});
