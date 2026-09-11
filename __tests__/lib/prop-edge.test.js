// NFL prop reads, shadow first (2026-09-11): the same formula shape as
// every team market. Anchor at the devigged consensus, model off the
// player's own game log, damp the disagreement by the dial and by
// sample, band the pp. Nothing publishes.

const pe = require('../../lib/services/prop-edge');

describe('consensusFromBooks', () => {
  const rows = [
    { bookmaker: 'betmgm', line: 218.5, over_price: -115, under_price: -115 },
    { bookmaker: 'betonlineag', line: 224.5, over_price: -114, under_price: -114 },
    { bookmaker: 'betrivers', line: 219.5, over_price: -117, under_price: -114 },
    { bookmaker: 'bovada', line: 224.5, over_price: -115, under_price: -115 },
    { bookmaker: 'draftkings', line: 224.5, over_price: -111, under_price: -113 },
    { bookmaker: 'fanatics', line: 220.5, over_price: -115, under_price: -115 },
    { bookmaker: 'fanduel', line: 220.5, over_price: -114, under_price: -114 },
  ];
  test('median line, devigged over probability at that line, best price per side', () => {
    const c = pe.consensusFromBooks(rows);
    expect(c.line).toBe(220.5);
    expect(c.atLine).toBe(2);
    expect(c.overProb).toBeCloseTo(0.5, 6);
    expect(c.books).toBe(7);
    expect(c.best.over.book).toBe('draftkings');
    expect(c.best.over.line).toBe(224.5);
  });
  test('a lopsided price moves the anchor off a half', () => {
    const c = pe.consensusFromBooks([{ bookmaker: 'x', line: 3.5, over_price: -150, under_price: 120 }]);
    expect(c.overProb).toBeGreaterThan(0.55);
  });
  test('no usable rows is null', () => {
    expect(pe.consensusFromBooks([])).toBeNull();
    expect(pe.consensusFromBooks([{ bookmaker: 'x', line: null, over_price: -110, under_price: -110 }])).toBeNull();
  });
});

describe('playerBaseline', () => {
  const log = (vals) => vals.map(v => ({ passing_yards: v }));
  test('blends the recent window with the longer history and floors sigma', () => {
    const b = pe.playerBaseline(log([300, 280, 260, 240, 220, 200, 200, 200, 200, 200]), 'player_pass_yds');
    expect(b.games).toBe(10);
    expect(b.recentMean).toBeCloseTo(260, 6);
    expect(b.longMean).toBeCloseTo(230, 6);
    expect(b.mean).toBeCloseTo(245, 6);
    expect(b.sigma).toBeGreaterThanOrEqual(45);
  });
  test('the dials set the window, the weight, and the history length', () => {
    const b = pe.playerBaseline(log([300, 100, 100, 100]), 'player_pass_yds', { prop_recent_window: 1, prop_recent_weight: 1, prop_history_games: 2 });
    expect(b.mean).toBeCloseTo(300, 6);
    expect(b.games).toBe(2);
  });
  test('no history or an unmodeled market is null', () => {
    expect(pe.playerBaseline([], 'player_pass_yds')).toBeNull();
    expect(pe.playerBaseline(log([1]), 'player_anytime_td')).toBeNull();
  });
});

describe('propRead', () => {
  test('agreeing with the book is no edge', () => {
    const r = pe.propRead({ line: 220.5, anchorOverProb: 0.5, mean: 220.5, sigma: 50, games: 17 });
    expect(r.modelProb).toBeCloseTo(0.5, 4);
    expect(r.edgePp).toBe(0);
  });
  test('half the disagreement prices the side at full sample', () => {
    const r = pe.propRead({ line: 220.5, anchorOverProb: 0.5, mean: 260, sigma: 50, games: 17 });
    expect(r.confidence).toBe(1);
    expect(r.dampedProb).toBeCloseTo(0.5 + 0.5 * (r.modelProb - 0.5), 10);
    expect(r.side).toBe('over');
    expect(r.edgePp).toBeCloseTo(Math.round((r.dampedProb - 0.5) * 1000) / 10, 6);
  });
  test('a two game sample keeps forty percent of that', () => {
    const full = pe.propRead({ line: 220.5, anchorOverProb: 0.5, mean: 260, sigma: 50, games: 17 });
    const thin = pe.propRead({ line: 220.5, anchorOverProb: 0.5, mean: 260, sigma: 50, games: 2 });
    expect(thin.confidence).toBeCloseTo(0.4, 10);
    expect(thin.edgeOver).toBeCloseTo(0.4 * full.edgeOver, 10);
  });
  test('an under read carries a positive pp on the under side', () => {
    const r = pe.propRead({ line: 4.5, anchorOverProb: 0.52, mean: 3.2, sigma: 1.5, games: 12 });
    expect(r.side).toBe('under');
    expect(r.edgePp).toBeGreaterThan(0);
  });
  test('damp 0 is pure market, damp is a dial', () => {
    const r = pe.propRead({ line: 220.5, anchorOverProb: 0.5, mean: 300, sigma: 50, games: 17 }, { prop_claim_damp: 0 });
    expect(r.edgePp).toBe(0);
  });
});

describe('nflWeekFor and gradeRead', () => {
  test('the 2026 opener is week 1 and the following Sunday is still week 1', () => {
    expect(pe.nflWeekFor('2026-09-11T00:35:00Z')).toEqual({ season: 2026, week: 1 });
    expect(pe.nflWeekFor('2026-09-13T20:25:00Z')).toEqual({ season: 2026, week: 1 });
    expect(pe.nflWeekFor('2026-09-15T06:30:00Z')).toEqual({ season: 2026, week: 2 });
    // Wildcard weekend of the 2025 season is nflverse week 19.
    expect(pe.nflWeekFor('2026-01-11T18:00:00Z')).toEqual({ season: 2025, week: 19 });
  });
  test('grades over, under, and push', () => {
    expect(pe.gradeRead('over', 220.5, 231)).toBe('won');
    expect(pe.gradeRead('over', 220.5, 200)).toBe('lost');
    expect(pe.gradeRead('under', 4.5, 3)).toBe('won');
    expect(pe.gradeRead('under', 4.5, 7)).toBe('lost');
    expect(pe.gradeRead('over', 4, 4)).toBe('push');
    expect(pe.gradeRead('over', 4, null)).toBeNull();
  });
});
