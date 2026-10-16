process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const { getDigestLive } = require('../../api/digest-live');
const { _resetCache } = require('../../lib/services/live-game-scores.js');

// game_analysis rows for the first query, ai_suggestions rows for attachPublishedPicks.
function fakeSupabase({ games, picks }) {
  const mk = (rows) => {
    const chain = { then(resolve) { resolve({ data: rows, error: null }); } };
    for (const m of ['select', 'like', 'eq', 'is', 'not', 'gt', 'gte', 'lte', 'order', 'limit', 'in']) chain[m] = () => chain;
    return chain;
  };
  return { from: (table) => mk(table === 'game_analysis' ? games : picks) };
}

function fakeRes() {
  const res = { headers: {}, body: null, code: 200 };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const scoreboard = {
  events: [{
    id: '401', date: '2026-10-16T00:15Z',
    status: { period: 3, displayClock: '8:42', type: { state: 'in', completed: false, shortDetail: '8:42 - 3rd' } },
    competitions: [{
      situation: { possession: '2' },
      competitors: [
        { id: '1', homeAway: 'home', score: '14', team: { id: '1', displayName: 'New York Giants', abbreviation: 'NYG' } },
        { id: '2', homeAway: 'away', score: '17', team: { id: '2', displayName: 'Philadelphia Eagles', abbreviation: 'PHI' } },
      ],
    }],
  }],
};

describe('GET /api/digest/live', () => {
  beforeEach(() => _resetCache());

  test('returns the tracker for started games with a published pick, no caching header', async () => {
    const games = [{ game_key: 'g1', home_team: 'New York Giants', away_team: 'Philadelphia Eagles', game_date: '2026-10-16T00:15:00Z', sport: 'NFL', spread: 3.5, total: 44.5, trap_calls: [] }];
    const picks = [{ home_team: 'New York Giants', away_team: 'Philadelphia Eagles', pick: 'Philadelphia Eagles -3.5', bet_type: 'Spread', odds: '-110', tier: 'Play', session_id: 'auto_digest_2026-10-15', actual_outcome: 'pending' }];
    const res = fakeRes();
    const fetchFn = jest.fn(async () => ({ ok: true, json: async () => scoreboard }));
    await getDigestLive({}, res, { supabase: fakeSupabase({ games, picks }), fetchFn });
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body.games.g1.pick).toMatchObject({ status: 'behind' });
    expect(res.body.games.g1.home.abbr).toBe('NYG');
  });

  test('a database outage answers an empty tracker, the board stays up', async () => {
    const down = { from: () => ({ select: () => { throw new Error('down'); } }) };
    const res = fakeRes();
    await getDigestLive({}, res, { supabase: down, fetchFn: jest.fn() });
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ games: {}, error: 'unavailable' });
  });
});
