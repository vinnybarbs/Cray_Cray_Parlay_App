const rf = require('../../lib/replay/replay-formula.js');
const ds = require('../../lib/replay/dial-search.js');
const h = require('../../lib/services/historical-odds.js');
const { windowDays } = require('../../api/cron/backfill-historical-odds.js');

describe('history replay helpers', () => {
  const close = (book, market, outcomes, extra = {}) => ({
    external_game_id: 'g1', commence_time: '2024-10-06T17:00:00Z', home_team: 'Home', away_team: 'Away',
    bookmaker: book, market_type: market, outcomes, ...extra,
  });

  test('rowsFromCloses prices a game at the first book with a moneyline, every market from that book', () => {
    const rows = rf.rowsFromCloses([
      close('fanduel', 'h2h', [{ name: 'Home', price: -150 }, { name: 'Away', price: 130 }]),
      close('draftkings', 'h2h', [{ name: 'Home', price: -145 }, { name: 'Away', price: 125 }]),
      close('draftkings', 'spreads', [{ name: 'Home', point: -3, price: -105 }, { name: 'Away', point: 3, price: -115 }]),
      close('draftkings', 'totals', [{ name: 'Over', point: 44.5, price: -110 }, { name: 'Under', point: 44.5, price: -110 }]),
      close('fanduel', 'totals', [{ name: 'Over', point: 45.5, price: -110 }, { name: 'Under', point: 45.5, price: -110 }]),
    ], 'NFL');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ game_key: 'g1', sport: 'NFL', book: 'draftkings', moneyline_home: -145, moneyline_away: 125, spread: -3, spread_home_price: -105, spread_away_price: -115, total: 44.5 });
    const game = rf.gameFromAnalysis(rows[0]);
    expect(game.markets.h2h).toHaveLength(2);
    expect(rf.gradeSide('home_spread', game, 24, 20)).toBe('won');
  });

  test('rowsFromCloses drops a game without a two sided moneyline', () => {
    expect(rf.rowsFromCloses([close('draftkings', 'h2h', [{ name: 'Home', price: -150 }])], 'NFL')).toEqual([]);
    expect(rf.rowsFromCloses([close('draftkings', 'totals', [{ name: 'Over', point: 40, price: -110 }])], 'NFL')).toEqual([]);
  });

  test('priorSeasonWindows covers the same span one, two and three years back', () => {
    const w = rf.priorSeasonWindows(Date.parse('2026-10-13T08:00:00Z'), 67, 3);
    expect(w).toHaveLength(3);
    expect(w[0].until).toBe('2025-10-13T08:00:00.000Z');
    expect(w[2].until).toBe('2023-10-13T08:00:00.000Z');
    expect(Date.parse(w[0].until) - Date.parse(w[0].since)).toBe(67 * 86400000);
  });

  test('historyVerdicts drops a variant that lost to base, and holds everything on thin history', () => {
    const summary = { formulas: { base: { picks: 80, won: 42, lost: 38, units: 1.5 }, a_up: { picks: 70, won: 33, lost: 37, units: -4 }, b_dn: { picks: 75, won: 41, lost: 34, units: 3.2 } } };
    const v = ds.historyVerdicts(summary, ['a_up', 'b_dn']);
    expect(v.a_up).toMatchObject({ checked: true, holds: false, delta_units: -5.5 });
    expect(v.b_dn).toMatchObject({ checked: true, holds: true, delta_units: 1.7 });
    const thin = ds.historyVerdicts({ formulas: { base: { picks: 5, units: 1 }, a_up: { picks: 4, units: -3 } } }, ['a_up']);
    expect(thin.a_up).toMatchObject({ checked: false, holds: true });
  });

  test('windowDays lists every day of a month window', () => {
    const d = windowDays('2024-02-01', '2024-03-01');
    expect(d).toHaveLength(29);
    expect(d[0]).toBe('20240201');
    expect(d[28]).toBe('20240229');
  });

  test('daily sports sample the events list every day', async () => {
    const urls = [];
    const fetchFn = async (url) => { urls.push(url); return { ok: true, status: 200, headers: { get: () => '1' }, json: async () => ({ data: [] }) }; };
    await h.backfillWindow({ fetchFn, supabase: {}, apiKey: 'k', sport: 'baseball_mlb', markets: 'h2h,spreads,totals', windowStart: '2024-05-01', windowEnd: '2024-05-08' });
    const daily = urls.length;
    urls.length = 0;
    await h.backfillWindow({ fetchFn, supabase: {}, apiKey: 'k', sport: 'americanfootball_nfl', markets: 'h2h,spreads,totals', windowStart: '2024-05-01', windowEnd: '2024-05-08' });
    expect(daily).toBeGreaterThan(urls.length);
    expect(daily).toBe(9);
  });
});
