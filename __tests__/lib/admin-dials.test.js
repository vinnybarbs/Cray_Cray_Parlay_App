// The read only dial board endpoint (owner 2026-09-15): the pure helpers
// that merge the board, split it, and attach picks to reads, plus the
// admin_users allowlist path in requireAdmin.

const { mergeDials, groupDials, attachPicks, SPORTS } = require('../../api/admin-dials');
const { requireAdmin, _resetAdminCache } = require('../../api/admin-dashboard');

describe('mergeDials', () => {
  test('sport row wins over __all__ and the scope that won is recorded', () => {
    const rows = [
      { sport: '__all__', dial: 'venue_weight', value: 0.25, updated_at: 'a' },
      { sport: 'MLB', dial: 'venue_weight', value: 0.3125, updated_at: 'b' },
      { sport: '__all__', dial: 'form_weight', value: 0, updated_at: 'c' },
      { sport: 'NFL', dial: 'injury_weight', value: 1, updated_at: 'd' },
    ];
    const out = mergeDials(rows, 'MLB');
    expect(out.map(d => d.dial)).toEqual(['form_weight', 'venue_weight']);
    expect(out.find(d => d.dial === 'venue_weight')).toMatchObject({ value: 0.3125, scope: 'MLB' });
    expect(out.find(d => d.dial === 'form_weight')).toMatchObject({ value: 0, scope: '__all__' });
  });

  test('sport row wins whatever the input order', () => {
    const rows = [
      { sport: 'MLB', dial: 'venue_weight', value: 0.3125 },
      { sport: '__all__', dial: 'venue_weight', value: 0.25 },
    ];
    expect(mergeDials(rows, 'MLB')[0]).toMatchObject({ value: 0.3125, scope: 'MLB' });
  });

  test('empty and null input give an empty board', () => {
    expect(mergeDials(null, 'MLB')).toEqual([]);
    expect(mergeDials([], 'NFL')).toEqual([]);
  });
});

describe('groupDials', () => {
  test('splits rails and publication flags away from the factor dials', () => {
    const merged = mergeDials([
      { sport: '__all__', dial: 'chalk_penalty_pp', value: 3 },
      { sport: '__all__', dial: 'longshot_penalty_pp', value: 6 },
      { sport: '__all__', dial: 'exposure_guard_pp', value: 2 },
      { sport: 'NFL', dial: 'publish_ml', value: 1 },
      { sport: 'NFL', dial: 'publish_total', value: '0' },
      { sport: 'NFL', dial: 'injury_weight', value: 1 },
    ], 'NFL');
    const g = groupDials(merged);
    expect(g.factors.map(d => d.dial)).toEqual(['injury_weight']);
    expect(g.rails.map(d => d.dial).sort()).toEqual(['chalk_penalty_pp', 'exposure_guard_pp', 'longshot_penalty_pp']);
    expect(g.publish).toEqual({ ml: 1, total: 0 });
  });
});

describe('attachPicks', () => {
  const reads = [
    { id: 1, home_team: 'Los Angeles Chargers', away_team: 'Arizona Cardinals', game_date: '2026-09-13T20:05:00Z' },
    { id: 2, home_team: 'Los Angeles Chargers', away_team: 'Arizona Cardinals', game_date: '2026-09-20T20:05:00Z' },
    { id: 3, home_team: 'Denver Broncos', away_team: 'Kansas City Chiefs', game_date: '2026-09-13T20:25:00Z' },
  ];

  test('a pick lands on the read for the same matchup near the same kickoff only', () => {
    const picks = [
      { id: 'p1', home_team: 'Los Angeles Chargers', away_team: 'Arizona Cardinals', game_date: '2026-09-13T20:00:00Z' },
      { id: 'p2', home_team: 'Los Angeles Chargers', away_team: 'Arizona Cardinals', game_date: '2026-09-20T21:00:00Z' },
      { id: 'p3', home_team: 'Denver Broncos', away_team: 'Kansas City Chiefs', game_date: '2026-09-13T20:25:00Z' },
      { id: 'p4', home_team: 'Nobody', away_team: 'Anyone', game_date: '2026-09-13T20:25:00Z' },
    ];
    const by = attachPicks(reads, picks);
    expect(by.get(1).map(p => p.id)).toEqual(['p1']);
    expect(by.get(2).map(p => p.id)).toEqual(['p2']);
    expect(by.get(3).map(p => p.id)).toEqual(['p3']);
    expect(by.size).toBe(3);
  });

  test('a pick more than six hours from every read stays unattached', () => {
    const picks = [{ id: 'far', home_team: 'Denver Broncos', away_team: 'Kansas City Chiefs', game_date: '2026-09-14T08:00:00Z' }];
    expect(attachPicks(reads, picks).size).toBe(0);
  });

  test('null inputs give an empty map', () => {
    expect(attachPicks(null, null).size).toBe(0);
  });
});

test('every published market is a known sport string', () => {
  expect(SPORTS).toEqual(expect.arrayContaining(['MLB', 'NFL', 'NCAAF']));
});

describe('requireAdmin with the admin_users table', () => {
  function mockRes() {
    const res = { code: null, body: null };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  }
  function mockSupabase(email, tableRows, tableError = null) {
    return {
      auth: { getUser: async () => ({ data: { user: { email } }, error: null }) },
      from: (table) => ({
        select: async () => (table === 'admin_users' ? { data: tableRows, error: tableError } : { data: [], error: null }),
      }),
    };
  }
  beforeEach(() => _resetAdminCache());

  test('an account on the table passes', async () => {
    const res = mockRes();
    const user = await requireAdmin({ headers: { authorization: 'Bearer t' } }, res, mockSupabase('Friend@Example.com', [{ email: 'friend@example.com' }]));
    expect(user).toMatchObject({ email: 'Friend@Example.com' });
    expect(res.code).toBeNull();
  });

  test('an account on neither list gets 403', async () => {
    const res = mockRes();
    const user = await requireAdmin({ headers: { authorization: 'Bearer t' } }, res, mockSupabase('stranger@example.com', [{ email: 'friend@example.com' }]));
    expect(user).toBeNull();
    expect(res.code).toBe(403);
  });

  test('the env floor still passes when the table read fails', async () => {
    const res = mockRes();
    const user = await requireAdmin({ headers: { authorization: 'Bearer t' } }, res, mockSupabase('vincemorello12@gmail.com', null, { message: 'down' }));
    expect(user).toMatchObject({ email: 'vincemorello12@gmail.com' });
  });

  test('no bearer token gets 401', async () => {
    const res = mockRes();
    const user = await requireAdmin({ headers: {} }, res, mockSupabase('x', []));
    expect(user).toBeNull();
    expect(res.code).toBe(401);
  });
});
