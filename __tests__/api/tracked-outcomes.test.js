process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const { getTrackedOutcomes, gameOutcomes, propOutcomes } = require('../../api/tracked-outcomes');

function fakeSupabase({ picks, reads }) {
  const mk = (rows) => {
    const chain = { then(resolve) { resolve({ data: rows, error: null }); } };
    for (const m of ['select', 'like', 'eq', 'is', 'not', 'gt', 'gte', 'lte', 'order', 'limit', 'in']) chain[m] = () => chain;
    return chain;
  };
  return { from: (table) => mk(table === 'ai_suggestions' ? picks : reads) };
}

function fakeRes() {
  const res = { headers: {}, body: null, code: 200 };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

describe('gameOutcomes', () => {
  const items = [
    { key: 'game:a:Eagles -3', home_team: 'Giants', away_team: 'Eagles', pick: 'Eagles -3' },
    { key: 'game:b:Over 44.5', home_team: 'Jets', away_team: 'Bills', pick: 'Over 44.5' },
  ];
  it('matches by teams and pick text and prefers the graded row', () => {
    const rows = [
      { home_team: 'Giants', away_team: 'Eagles', pick: 'Eagles -3', actual_outcome: 'pending', tier: 'Play' },
      { home_team: 'Giants', away_team: 'Eagles', pick: 'Eagles -3', actual_outcome: 'won', tier: 'Play' },
      { home_team: 'Jets', away_team: 'Bills', pick: 'Bills -7', actual_outcome: 'lost', tier: 'Lean' },
    ];
    expect(gameOutcomes(items, rows)).toEqual({ 'game:a:Eagles -3': { outcome: 'won', tier: 'Play' } });
  });
});

describe('propOutcomes', () => {
  it('matches by player, market, side and line, and carries the actual stat', () => {
    const items = [{ key: 'prop:x', playerKey: 'puka nacua', market: 'player_receptions', side: 'over', line: 6.5 }];
    const rows = [
      { player_key: 'puka nacua', market: 'player_receptions', v2_side: 'over', line: '6.5', v2_outcome: 'won', actual_value: '8' },
      { player_key: 'puka nacua', market: 'player_receptions', v2_side: 'over', line: '7.5', v2_outcome: 'lost', actual_value: '8' },
    ];
    expect(propOutcomes(items, rows)).toEqual({ 'prop:x': { outcome: 'won', actual: 8 } });
  });
});

describe('POST /api/tracked/outcomes', () => {
  it('returns grades for both kinds and never caches', async () => {
    const req = { body: {
      games: [{ key: 'g1', home_team: 'Giants', away_team: 'Eagles', pick: 'Eagles -3', game_date: '2026-10-16T00:15Z' }],
      props: [{ key: 'p1', playerKey: 'puka nacua', market: 'player_receptions', side: 'over', line: 6.5, commence_time: '2026-10-16T00:15Z' }],
    } };
    const res = fakeRes();
    await getTrackedOutcomes(req, res, { supabase: fakeSupabase({
      picks: [{ home_team: 'Giants', away_team: 'Eagles', pick: 'Eagles -3', actual_outcome: 'lost', tier: 'Play' }],
      reads: [{ player_key: 'puka nacua', market: 'player_receptions', v2_side: 'over', line: 6.5, v2_outcome: null, actual_value: null }],
    }) });
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body.games).toEqual({ g1: { outcome: 'lost', tier: 'Play' } });
    expect(res.body.props).toEqual({ p1: { outcome: 'pending', actual: null } });
  });

  it('ignores malformed items and an empty body', async () => {
    const res = fakeRes();
    await getTrackedOutcomes({ body: { games: [{ key: 'x' }], props: 'nope' } }, res, { supabase: fakeSupabase({ picks: [], reads: [] }) });
    expect(res.body).toMatchObject({ games: {}, props: {} });
  });
});
