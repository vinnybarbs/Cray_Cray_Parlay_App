process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const { shapePlayer } = require('../../api/player');

// Owner 2026-10-13: a tappable player sheet with a game log and every
// read we made on the player, graded.
const stat = (o) => ({
  season: 2026, week: 1, player_name: 'Puka Nacua', position: 'WR', team: 'LA', opponent: 'BUF',
  completions: 0, attempts: 0, passing_yards: 0, passing_tds: 0, interceptions: 0, carries: 0, rushing_yards: 0, rushing_tds: 0,
  targets: 9, receptions: 7, receiving_yards: 88, receiving_tds: 1, ...o,
});
const read = (o) => ({
  market: 'player_receptions', player_name: 'Puka Nacua', line: 5.5, v2_side: 'over', v2_edge_pp: 6,
  v2_outcome: 'won', v2_factors: { opponent: 'BUF' }, actual_value: 7, commence_time: '2026-10-05T17:00:00Z', ...o,
});

describe('shapePlayer', () => {
  it('builds the latest season log newest first with averages and used stats', () => {
    const out = shapePlayer([stat({ week: 1 }), stat({ week: 3, receptions: 5 }), stat({ season: 2025, week: 17 })], [], null);
    expect(out.season).toBe(2026);
    expect(out.games.map(g => g.week)).toEqual([3, 1]);
    expect(out.averages.receptions).toBe(6);
    expect(out.used).toEqual(['targets', 'receptions', 'receiving_yards', 'receiving_tds']);
    expect(out.player).toEqual({ name: 'Puka Nacua', team: 'LA', position: 'WR' });
  });

  it('lists shown reads newest first with a record, dropping reads under the floor', () => {
    const out = shapePlayer([stat()], [
      read(),
      read({ commence_time: '2026-10-12T17:00:00Z', v2_outcome: 'lost', actual_value: 4 }),
      read({ v2_edge_pp: 2, commence_time: '2026-10-13T17:00:00Z' }),
    ], null);
    expect(out.reads).toHaveLength(2);
    expect(out.reads[0]).toMatchObject({ label: 'over 5.5 receptions', outcome: 'lost', actual: 4, opponent: 'BUF' });
    expect(out.record).toEqual({ won: 1, lost: 1, push: 0 });
  });

  it('returns no player when there is no game log', () => {
    expect(shapePlayer([], [], null).player).toBeNull();
  });
});
