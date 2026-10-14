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
});
