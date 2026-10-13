process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const { attachPublishedPicks } = require('../../api/digest');

// A thenable query builder: every filter returns itself, awaiting it
// yields the rows.
function fakeSupabase(rows, calls = []) {
  const chain = { then(resolve) { resolve({ data: rows, error: null }); } };
  for (const m of ['select', 'like', 'eq', 'is', 'not', 'gt', 'gte', 'lte', 'order', 'limit']) {
    chain[m] = (...args) => { calls.push([m, ...args]); return chain; };
  }
  return { from: () => chain };
}

const pending = [
  { home_team: 'Los Angeles Rams', away_team: 'Tennessee Titans', pick: 'Tennessee Titans ML +114', bet_type: 'Moneyline', odds: '+114', edge_pp: '3.1', tier: 'Lean', tier_history: [], last_revised_at: null, session_id: 'auto_digest_2026-09-24' },
  { home_team: 'Los Angeles Rams', away_team: 'Tennessee Titans', pick: 'Tennessee Titans +2.5', bet_type: 'Spread', odds: '-102', edge_pp: '3.3', tier: 'Lean', tier_history: [], last_revised_at: null, session_id: 'auto_digest_alt_spread_2026-09-24' },
];

// Owner 2026-09-27: the Research modal scored the live analysis row
// alone and printed Skip on a published NFL Lean. The same attach now
// serves /api/digest and /api/deep-research.
describe('attachPublishedPicks', () => {
  test('a game with a pending headline row gets published_pick and its spotlight rows', async () => {
    const game = { home_team: 'Los Angeles Rams', away_team: 'Tennessee Titans', recommended_pick: 'Tennessee Titans ML +114', edges: { away_ml: 0.0001 } };
    await attachPublishedPicks(fakeSupabase(pending), [game]);
    expect(game.published_pick).toMatchObject({ pick: 'Tennessee Titans ML +114', tier: 'Lean', edge_pp: '3.1' });
    expect(game.published_alts).toHaveLength(1);
    expect(game.published_alts[0].pick).toBe('Tennessee Titans +2.5');
  });

  test('a game with no row gets explicit nulls, never undefined', async () => {
    const game = { home_team: 'A', away_team: 'B' };
    await attachPublishedPicks(fakeSupabase(pending), [game]);
    expect(game.published_pick).toBeNull();
    expect(game.published_alts).toBeNull();
  });

  test('a single deep research row is attached in place', async () => {
    const row = { home_team: 'Los Angeles Rams', away_team: 'Tennessee Titans' };
    const out = await attachPublishedPicks(fakeSupabase(pending), [row]);
    expect(out[0]).toBe(row);
    expect(row.published_pick.pick).toBe('Tennessee Titans ML +114');
  });

  test('empty input and a query outage are harmless', async () => {
    expect(await attachPublishedPicks(fakeSupabase([]), [])).toEqual([]);
    const down = { from: () => ({ select: () => { throw new Error('down'); } }) };
    const game = { home_team: 'A', away_team: 'B' };
    await attachPublishedPicks(down, [game]);
    expect(game.published_pick).toBeNull();
  });

  // Owner 2026-10-13: started games keep their tile, so a graded pick
  // must still attach, with its outcome, and the pending filter must be off.
  it('started mode attaches graded picks with their outcome', async () => {
    const calls = [];
    const graded = pending.map(p => ({ ...p, actual_outcome: 'won' }));
    const game = { home_team: 'Los Angeles Rams', away_team: 'Tennessee Titans' };
    await attachPublishedPicks(fakeSupabase(graded, calls), [game], { started: true });
    expect(game.published_pick.outcome).toBe('won');
    expect(game.published_alts[0].outcome).toBe('won');
    expect(calls.some(c => c[0] === 'eq' && c[1] === 'actual_outcome')).toBe(false);
    expect(calls.some(c => c[0] === 'gte' && c[1] === 'game_date')).toBe(true);
  });

  it('upcoming mode keeps the pending filter', async () => {
    const calls = [];
    await attachPublishedPicks(fakeSupabase(pending, calls), [{ home_team: 'x', away_team: 'y' }]);
    expect(calls).toContainEqual(['eq', 'actual_outcome', 'pending']);
  });
});
