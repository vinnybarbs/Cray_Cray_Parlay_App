// The counterfactual replay harness: the game builder, the grader, the
// as-of facade, and the two formula runners on a mocked database.

const rf = require('../../lib/replay/replay-formula');

const row = {
  game_key: 'k', sport: 'MLB', home_team: 'Boston Red Sox', away_team: 'Kansas City Royals',
  game_date: '2026-09-11T23:11:00Z', spread: '-1.5', total: '8.5', moneyline_home: -205, moneyline_away: 172,
  spread_home_price: null, spread_away_price: null, over_price: -104, under_price: -116,
};

describe('gameFromAnalysis', () => {
  const g = rf.gameFromAnalysis(row);
  test('builds the three markets the calculators read', () => {
    expect(g.sport).toBe('baseball_mlb');
    expect(g.markets.h2h).toEqual([{ name: 'Boston Red Sox', price: -205 }, { name: 'Kansas City Royals', price: 172 }]);
    expect(g.markets.spreads[1]).toEqual({ name: 'Kansas City Royals', point: 1.5, price: -110 });
    expect(g.markets.totals[0]).toEqual({ name: 'Over', point: 8.5, price: -104 });
  });
  test('prices per side, defaulting spreads to -110', () => {
    expect(rf.priceForSide(g, 'away_ml')).toBe(172);
    expect(rf.priceForSide(g, 'home_spread')).toBe(-110);
    expect(rf.priceForSide(g, 'under')).toBe(-116);
  });
});

describe('gradeSide and units', () => {
  const g = rf.gameFromAnalysis(row);
  test('moneyline, spread, total', () => {
    expect(rf.gradeSide('home_ml', g, 5, 3)).toBe('won');
    expect(rf.gradeSide('away_ml', g, 5, 3)).toBe('lost');
    expect(rf.gradeSide('home_spread', g, 4, 3)).toBe('lost');   // -1.5 needs 2
    expect(rf.gradeSide('home_spread', g, 5, 3)).toBe('won');
    expect(rf.gradeSide('away_spread', g, 4, 3)).toBe('won');
    expect(rf.gradeSide('over', g, 5, 4)).toBe('won');
    expect(rf.gradeSide('under', g, 5, 4)).toBe('lost');
    expect(rf.gradeSide('over', g, 4, 4)).toBe('lost');
  });
  test('units at price', () => {
    expect(rf.unitsFor('won', -205)).toBeCloseTo(0.4878, 3);
    expect(rf.unitsFor('won', 172)).toBeCloseTo(1.72, 6);
    expect(rf.unitsFor('lost', 172)).toBe(-1);
    expect(rf.unitsFor('push', 172)).toBe(0);
  });
  test('the site date is Denver', () => {
    expect(rf.siteDate('2026-09-12T03:30:00Z')).toBe('2026-09-11');
  });
});

describe('asOfSupabase', () => {
  test('filters game_results before the date, empties news, passes others through', () => {
    const calls = [];
    const fb = { lt: (col, v) => { calls.push(['lt', col, v]); return fb; }, eq: () => fb };
    const real = { from: (t) => ({ select: (...a) => { calls.push(['select', t, a]); return fb; }, insert: () => 'ins' }) };
    const facade = rf.asOfSupabase(real, '2026-09-01');
    facade.from('game_results').select('x');
    expect(calls).toEqual([['select', 'game_results', ['x']], ['lt', 'date', '2026-09-01']]);
    calls.length = 0;
    facade.from('news_cache').select('summary');
    expect(calls[1][0]).toBe('lt');
    expect(calls[1][1]).toBe('last_updated');
    calls.length = 0;
    facade.from('sport_dials').select('v');
    expect(calls).toEqual([['select', 'sport_dials', ['v']]]);
    expect(facade.from('game_results').insert()).toBe('ins');
  });
});

describe('JULY_MULTIPLIERS', () => {
  test('are the 2026-07-10 seeds', () => {
    expect(rf.JULY_MULTIPLIERS['MLB:ml']).toBe(1.2);
    expect(rf.JULY_MULTIPLIERS['MLB:total']).toBe(0.55);
    expect(rf.JULY_MULTIPLIERS['MLB:spread']).toBe(0.6);
  });
});

describe('standingsFromGames', () => {
  const g = (h, a, hs, as, d) => ({ home_team_name: h, away_team_name: a, home_score: hs, away_score: as, date: d });
  test('season record, venue splits, last ten, and streak from the games before the date', () => {
    const rows = [
      g('Boston Red Sox', 'Kansas City Royals', 5, 3, '2026-09-10'),
      g('Boston Red Sox', 'Kansas City Royals', 4, 1, '2026-09-09'),
      g('New York Yankees', 'Boston Red Sox', 6, 2, '2026-09-08'),
      g('New York Yankees', 'Boston Red Sox', 1, 7, '2026-09-07'),
    ];
    const s = rf.standingsFromGames(rows, 'Boston Red Sox');
    expect(s.record).toBe('3-1');
    expect(s.home_record).toBe('2-0');
    expect(s.away_record).toBe('1-1');
    expect(s.streak).toBe('W2');
    expect(s.last_10).toBe('3-1');
    expect(s.win_percentage).toBe('0.750');
    expect(s.playoff_seed).toBeNull();
  });
  test('no games is null', () => {
    expect(rf.standingsFromGames([], 'Boston Red Sox')).toBeNull();
  });
});
