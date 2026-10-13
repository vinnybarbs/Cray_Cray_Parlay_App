const { shapeToday, latestPerGame } = require('../../api/today');

const row = (o) => ({
  sport: 'NFL', home_team: 'H', away_team: 'A', game_date: '2026-10-13T00:15:00Z',
  bet_type: 'Moneyline', pick: 'H ML -150', odds: '-150', edge_pp: 5, tier: 'Play',
  session_id: 'auto_digest_2026-10-12', ...o,
});

describe('latestPerGame', () => {
  it('keeps the newest session per game', () => {
    const out = latestPerGame([
      row({ session_id: 'auto_digest_2026-10-11', edge_pp: 9 }),
      row({ session_id: 'auto_digest_2026-10-12', edge_pp: 5 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].edge_pp).toBe(5);
  });
});

describe('shapeToday', () => {
  it('leads with plays, fills with leans to three, skips spotlight alternates', () => {
    const picks = [
      row({ home_team: 'A1', edge_pp: 6 }),
      row({ home_team: 'A2', edge_pp: 2.5, tier: 'Lean' }),
      row({ home_team: 'A3', edge_pp: 3.1, tier: 'Lean' }),
      row({ home_team: 'A4', edge_pp: 1.2, tier: 'Lean' }),
      row({ home_team: 'A5', edge_pp: 12, session_id: 'auto_digest_spotlight_2026-10-12' }),
    ];
    const out = shapeToday(picks, [], []);
    expect(out.picks.map(p => p.home_team)).toEqual(['A1', 'A3', 'A2']);
  });

  it('caps plays at five and adds no leans when three plays exist', () => {
    const picks = [4, 5, 6, 7, 8, 9, 2].map((e, i) => row({ home_team: `T${i}`, edge_pp: e }));
    const out = shapeToday(picks, [], []);
    expect(out.picks).toHaveLength(5);
    expect(out.picks.every(p => p.edge_pp >= 4)).toBe(true);
    expect(out.picks[0].edge_pp).toBe(9);
  });

  it('sorts traps most overpriced first and caps at three', () => {
    const traps = [-3, -8, -5, -4].map((e, i) => row({ home_team: `X${i}`, edge_pp: e, tier: 'Trap', session_id: 'auto_digest_trap_2026-10-12' }));
    const out = shapeToday([], traps, []);
    expect(out.traps.map(t => t.edge_pp)).toEqual([-8, -5, -4]);
  });

  it('reads the record from mv_public_record rows, trap row as bait record', () => {
    const rec = [
      { period_bucket: 'last_30d', dimension_type: 'overall', dimension_value: 'all', won: 30, lost: 20, push: 1, roi_units: 4.26 },
      { period_bucket: 'all', dimension_type: 'overall', dimension_value: 'all', won: 300, lost: 280, push: 9, roi_units: -2 },
      { period_bucket: 'all', dimension_type: 'tier', dimension_value: 'Trap', won: 134, lost: 93, push: 0, roi_units: -13.04 },
    ];
    const out = shapeToday([], [], rec);
    expect(out.record.last30).toEqual({ won: 30, lost: 20, push: 1, winRate: 60, units: 4.3 });
    expect(out.record.allTime.units).toBe(-2);
    expect(out.record.trapBait.units).toBe(-13);
  });
});

describe('bookAndOurPct (owner 2026-10-12: "Book says 56%, we say 67%")', () => {
  const { bookAndOurPct } = require('../../api/today.js');
  test('uses the stored no-vig implied probability when present', () => {
    expect(bookAndOurPct({ odds: '-112', implied_prob: 0.504, edge_pp: 5.5 })).toEqual({ book_pct: 50, our_pct: 56 });
  });
  test('falls back to the price with a typical margin removed', () => {
    expect(bookAndOurPct({ odds: '-110', edge_pp: 8.2 })).toEqual({ book_pct: 50, our_pct: 58 });
  });
  test('a trap reads lower than the book', () => {
    expect(bookAndOurPct({ odds: '-205', implied_prob: 0.645, edge_pp: -2.6 })).toEqual({ book_pct: 65, our_pct: 62 });
  });
  test('missing price or edge gives nulls', () => {
    expect(bookAndOurPct({ odds: null, edge_pp: 3 })).toEqual({ book_pct: null, our_pct: null });
    expect(bookAndOurPct({ odds: '-110', edge_pp: null })).toEqual({ book_pct: null, our_pct: null });
  });
});
