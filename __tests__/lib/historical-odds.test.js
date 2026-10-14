const h = require('../../lib/services/historical-odds.js');

describe('historical odds helpers', () => {
  test('event sample dates cover the window with a lead in', () => {
    const d = h.eventSampleDates('2025-01-01', '2025-01-10', 3);
    expect(d[0]).toBe('2024-12-29T00:00:00Z');
    expect(d[d.length - 1] <= '2025-01-10T00:00:00Z').toBe(true);
    expect(d.length).toBe(5);
  });

  test('groupByKickoff dedupes events and keeps the window only', () => {
    const ev = [
      { id: 'a', commence_time: '2025-01-04T15:00:00Z' },
      { id: 'a', commence_time: '2025-01-04T15:00:00Z' },
      { id: 'b', commence_time: '2025-01-04T15:00:00Z' },
      { id: 'c', commence_time: '2025-01-05T17:30:00Z' },
      { id: 'd', commence_time: '2025-02-01T15:00:00Z' },
    ];
    const g = h.groupByKickoff(ev, '2025-01-01', '2025-02-01');
    expect(h.groupByKickoff(ev, '2025-01-01', '2025-02-01', Date.parse('2025-01-05T00:00:00Z')).size).toBe(1);
    expect(g.size).toBe(2);
    expect(g.get('2025-01-04T15:00:00.000Z').length).toBe(2);
  });

  test('rowsFromSnapshot keeps only games at the kickoff', () => {
    const snap = {
      timestamp: '2025-01-04T14:55:00Z',
      data: [
        { id: 'a', commence_time: '2025-01-04T15:00:00Z', home_team: 'H', away_team: 'A',
          bookmakers: [{ key: 'draftkings', markets: [{ key: 'h2h', last_update: 'x', outcomes: [{ name: 'H', price: -110 }, { name: 'Draw', price: 250 }, { name: 'A', price: 300 }] }] }] },
        { id: 'z', commence_time: '2025-01-04T17:30:00Z', home_team: 'X', away_team: 'Y', bookmakers: [] },
      ],
    };
    const rows = h.rowsFromSnapshot('soccer_epl', snap, '2025-01-04T15:00:00.000Z');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sport: 'soccer_epl', external_game_id: 'a', bookmaker: 'draftkings', market_type: 'h2h', snapshot_at: '2025-01-04T14:55:00Z' });
  });

  test('backfillWindow takes one snapshot per kickoff a minute before it and counts credits', async () => {
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      const isEvents = url.includes('/events?');
      const body = isEvents
        ? { data: [{ id: 'a', commence_time: '2025-01-04T15:00:00Z' }, { id: 'b', commence_time: '2025-01-04T15:00:00Z' }] }
        : { timestamp: '2025-01-04T14:55:00Z', data: [
          { id: 'a', commence_time: '2025-01-04T15:00:00Z', home_team: 'H', away_team: 'A', bookmakers: [{ key: 'fanduel', markets: [{ key: 'h2h', outcomes: [{ name: 'H', price: 100 }] }] }] },
          { id: 'b', commence_time: '2025-01-04T15:00:00Z', home_team: 'C', away_team: 'D', bookmakers: [{ key: 'fanduel', markets: [{ key: 'totals', outcomes: [{ name: 'Over', price: -110, point: 2.5 }] }] }] },
        ] };
      return { ok: true, headers: { get: (k) => (k === 'x-requests-last' ? (isEvents ? '1' : '20') : null) }, json: async () => body };
    };
    const written = [];
    const supabase = { from: () => ({ upsert: async (rows) => { written.push(...rows); return { error: null }; } }) };
    const r = await h.backfillWindow({ fetchFn, supabase, apiKey: 'k', sport: 'soccer_epl', markets: 'h2h,totals', windowStart: '2025-01-01', windowEnd: '2025-01-08' });
    const oddsCalls = urls.filter((u) => u.includes('/odds?'));
    expect(oddsCalls).toHaveLength(1);
    expect(oddsCalls[0]).toContain('date=2025-01-04T14:59:00Z');
    expect(oddsCalls[0]).toContain('commenceTimeFrom=2025-01-04T15:00:00Z');
    expect(r.kickoffs).toBe(1);
    expect(r.gamesWithClose).toBe(2);
    expect(written).toHaveLength(2);
    expect(r.credits).toBe(urls.length - 1 + 20);
  });

  test('a failed request throws with the key masked', async () => {
    const fetchFn = async () => ({ ok: false, status: 401, headers: { get: () => null }, json: async () => ({}) });
    await expect(h.backfillWindow({ fetchFn, supabase: {}, apiKey: 'secret123', sport: 's', markets: 'h2h', windowStart: '2025-01-01', windowEnd: '2025-01-02' }))
      .rejects.toThrow(/apiKey=\*\*\*/);
  });

  test('rowsFromSnapshot keeps one row per game, book and market when the snapshot repeats one', () => {
    const game = { id: 'a', commence_time: '2025-02-11T20:00:00Z', home_team: 'H', away_team: 'A',
      bookmakers: [{ key: 'fanduel', markets: [{ key: 'h2h', outcomes: [{ name: 'H', price: 120 }] }] }] };
    const later = { ...game, bookmakers: [{ key: 'fanduel', markets: [{ key: 'h2h', outcomes: [{ name: 'H', price: 125 }] }] }] };
    const rows = h.rowsFromSnapshot('soccer_uefa_champs_league', { data: [game, later] }, '2025-02-11T20:00:00Z');
    expect(rows).toHaveLength(1);
    expect(rows[0].outcomes[0].price).toBe(125);
  });

  test('isPropMarkets is true only when every market is a player prop', () => {
    expect(h.isPropMarkets('player_receptions,player_pass_tds')).toBe(true);
    expect(h.isPropMarkets('h2h,totals')).toBe(false);
    expect(h.isPropMarkets('h2h,player_receptions')).toBe(false);
    expect(h.isPropMarkets('')).toBe(false);
  });

  test('propRowsFromEventSnapshot puts Over and Under on one row with the nflverse week', () => {
    const snap = {
      timestamp: '2024-09-15T16:55:00Z',
      data: {
        id: 'ev1', commence_time: '2024-09-15T17:00:00Z', home_team: 'H', away_team: 'A',
        bookmakers: [{ key: 'draftkings', markets: [
          { key: 'player_receptions', last_update: 'u', outcomes: [
            { name: 'Over', description: "Ja'Marr Chase", price: -115, point: 6.5 },
            { name: 'Under', description: "Ja'Marr Chase", price: -105, point: 6.5 },
          ] },
          { key: 'player_anytime_td', outcomes: [{ name: 'Yes', description: 'Joe Mixon', price: 120 }] },
        ] }],
      },
    };
    const rows = h.propRowsFromEventSnapshot('americanfootball_nfl', snap);
    expect(rows).toHaveLength(2);
    const rec = rows.find((r) => r.market === 'player_receptions');
    expect(rec).toMatchObject({ sport: 'NFL', event_id: 'ev1', season: 2024, week: 2, player_key: 'ja marr chase', line: 6.5, over_price: -115, under_price: -105, bookmaker: 'draftkings' });
    expect(rows.find((r) => r.market === 'player_anytime_td').yes_price).toBe(120);
    expect(h.propRowsFromEventSnapshot('americanfootball_nfl', null)).toEqual([]);
  });

  test('backfillPropsWindow takes one per event snapshot a minute before kickoff and skips unpriced games', async () => {
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      if (url.includes('/events?')) {
        return { ok: true, status: 200, headers: { get: (k) => (k === 'x-requests-last' ? '1' : null) },
          json: async () => ({ data: [{ id: 'a', commence_time: '2024-09-15T17:00:00Z' }, { id: 'b', commence_time: '2024-09-15T17:00:00Z' }] }) };
      }
      if (url.includes('/events/b/odds')) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
      return { ok: true, status: 200, headers: { get: (k) => (k === 'x-requests-last' ? '60' : null) },
        json: async () => ({ timestamp: '2024-09-15T16:55:00Z', data: { id: 'a', commence_time: '2024-09-15T17:00:00Z', bookmakers: [
          { key: 'fanduel', markets: [{ key: 'player_pass_tds', outcomes: [{ name: 'Over', description: 'Joe Burrow', price: 120, point: 1.5 }, { name: 'Under', description: 'Joe Burrow', price: -150, point: 1.5 }] }] },
        ] } }) };
    };
    const written = [];
    const supabase = { from: (t) => ({ upsert: async (rows) => { expect(t).toBe('historical_prop_closes'); written.push(...rows); return { error: null }; } }) };
    const r = await h.backfillPropsWindow({ fetchFn, supabase, apiKey: 'k', sport: 'americanfootball_nfl', markets: 'player_pass_tds', windowStart: '2024-09-01', windowEnd: '2024-10-01' });
    const eventOdds = urls.filter((u) => u.includes('/odds?'));
    expect(eventOdds).toHaveLength(2);
    expect(eventOdds[0]).toContain('/events/a/odds?');
    expect(eventOdds[0]).toContain('date=2024-09-15T16:59:00Z');
    expect(r).toMatchObject({ events: 2, kickoffs: 1, gamesWithClose: 1, rowsWritten: 1 });
    expect(written[0]).toMatchObject({ market: 'player_pass_tds', player_key: 'joe burrow', season: 2024, week: 2 });
    expect(r.credits).toBe(urls.length - 2 + 60);
  });
});
