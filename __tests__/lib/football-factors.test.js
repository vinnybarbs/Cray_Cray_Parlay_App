const { positionImpact, teamImpact, getFootballInjuryImpact, depthWeight, positionGroup, lookupRank, _setTeams, _setDepthRanks, _resetCache } = require('../../lib/services/football-injuries');
const { footballTotalPenalty } = require('../../lib/services/weather-data');
const { EdgeCalculator } = require('../../lib/services/edge-calculator');

describe('positionImpact', () => {
  test('a starting QB out dwarfs everything else', () => {
    expect(positionImpact('QB', 'Out')).toBeCloseTo(-0.06, 5);
    expect(positionImpact('QB', 'Doubtful')).toBeCloseTo(-0.03, 5);
    expect(positionImpact('QB', 'Questionable')).toBeCloseTo(-0.015, 5);
    expect(positionImpact('P', 'Out')).toBeCloseTo(-0.002, 5);
  });

  test('day-to-day and unknown statuses cost nothing', () => {
    expect(positionImpact('QB', 'Day-To-Day')).toBe(0);
    expect(positionImpact('WR', '')).toBe(0);
  });

  test('unknown positions get the small default', () => {
    expect(positionImpact('LS', 'Out')).toBeCloseTo(-0.006, 5);
  });
});

describe('teamImpact', () => {
  test('sums lines and caps at the team ceiling', () => {
    const lines = [
      { position: 'QB', status: 'out' },
      { position: 'WR', status: 'out' },
      { position: 'LT', status: 'out' },
      { position: 'CB', status: 'out' },
      { position: 'RB', status: 'out' },
      { position: 'TE', status: 'out' },
    ];
    expect(teamImpact(lines)).toBeCloseTo(-0.08, 5); // capped
    expect(teamImpact([])).toBe(0);
  });
});

describe('the depth chart gate (2026-09-15)', () => {
  test('the ladder: only the starting quarterback, receivers taper, one starter per line slot', () => {
    expect(depthWeight(1, 'QB')).toBe(1);
    expect(depthWeight(2, 'QB')).toBe(0);
    expect(depthWeight(1, 'WR')).toBe(1);
    expect(depthWeight(2, 'WR')).toBe(0.8);
    expect(depthWeight(3, 'WR')).toBe(0.6);
    expect(depthWeight(4, 'WR')).toBe(0.2);
    expect(depthWeight(5, 'WR')).toBe(0);
    expect(depthWeight(2, 'RB')).toBe(0.5);
    expect(depthWeight(3, 'RB')).toBe(0);
    expect(depthWeight(2, 'LT')).toBe(0);
    expect(depthWeight(2, 'CB')).toBe(0.5);
    expect(depthWeight(2, 'DE')).toBe(0.5);
    expect(depthWeight(2, 'S')).toBe(0.3);
    expect(depthWeight(2, 'K')).toBe(0);
    expect(depthWeight(2, 'XX')).toBe(0.5);
    expect(depthWeight(null, 'QB')).toBe(0.5);
    expect(depthWeight(undefined, 'QB', { unknown: 0 })).toBe(0);
    expect(positionGroup('LCB')).toBe('CB');
    expect(positionGroup('nt')).toBe('DL');
    expect(positionGroup('??')).toBeNull();
  });

  test('positionImpact scales by the gate weight', () => {
    expect(positionImpact('QB', 'Out', 1)).toBeCloseTo(-0.06, 5);
    expect(positionImpact('QB', 'Out', 0.5)).toBeCloseTo(-0.03, 5);
    expect(positionImpact('QB', 'Out', 0)).toBe(0);
  });

  test('lookupRank prefers the ESPN id, then name and position, then name', () => {
    const ranks = new Map([['GB', new Map([
      ['id:4047365', 1], ['name:josh jacobs|RB', 1], ['name:josh jacobs', 1],
      ['name:chris brooks|RB', 2], ['name:chris brooks', 2],
    ])]]);
    expect(lookupRank(ranks, 'GB', { player: 'J. Jacobs', position: 'RB', espnId: '4047365' })).toBe(1);
    expect(lookupRank(ranks, 'GB', { player: 'Chris Brooks', position: 'RB' })).toBe(2);
    expect(lookupRank(ranks, 'GB', { player: 'Chris Brooks', position: 'FB' })).toBe(2);
    expect(lookupRank(ranks, 'GB', { player: 'Nobody', position: 'RB' })).toBeNull();
    expect(lookupRank(ranks, 'KC', { player: 'Chris Brooks', position: 'RB' })).toBeNull();
    expect(lookupRank(null, 'GB', { player: 'Chris Brooks' })).toBeNull();
  });

  test('a backup quarterback out costs nothing and the starter costs 6pp', async () => {
    _setTeams(new Map([
      ['kansas city chiefs', [
        { player: 'Garrett Nussmeier', position: 'QB', status: 'Out', espnId: '999' },
        { player: 'Backup Guy', position: 'QB', status: 'Out', espnId: '998' },
      ]],
      ['green bay packers', [
        { player: 'Josh Jacobs', position: 'RB', status: 'Out', espnId: '4047365' },
        { player: 'Jordan Love', position: 'QB', status: 'Out' },
      ]],
    ]));
    const ranks = new Map([
      ['KC', new Map([['id:999', 3], ['name:garrett nussmeier', 3], ['id:998', 2], ['name:backup guy', 2]])],
      // Jacobs is rank 4 on the newest chart but the window floor is 1.
      ['GB', new Map([['id:4047365', 1], ['name:josh jacobs', 1], ['name:jordan love|QB', 1], ['name:jordan love', 1]])],
    ]);
    const kc = await getFootballInjuryImpact('Kansas City Chiefs', { depthRanks: ranks });
    expect(kc.impact).toBe(0);
    expect(kc.out).toBe(2);
    expect(kc.lines[0]).toMatchObject({ depth_rank: 3, depth_weight: 0 });
    expect(kc.lines[1]).toMatchObject({ depth_rank: 2, depth_weight: 0 });
    const gb = await getFootballInjuryImpact('Green Bay Packers', { depthRanks: ranks });
    expect(gb.impact).toBeCloseTo(-0.075, 5);
    expect(gb.keyLoss).toContain('Jordan Love');
    expect(gb.keyLoss).toContain('rank 1');
  });

  test('a player the chart does not list costs the unknown share, never zero by default', async () => {
    _setTeams(new Map([['denver broncos', [{ player: 'Mystery Man', position: 'QB', status: 'Out' }]]]));
    const r = await getFootballInjuryImpact('Denver Broncos', { depthRanks: new Map([['DEN', new Map()]]) });
    expect(r.impact).toBeCloseTo(-0.03, 5);
    const z = await getFootballInjuryImpact('Denver Broncos', { depthRanks: new Map([['DEN', new Map()]]), unknownWeight: 0 });
    expect(z.impact).toBe(0);
  });
});

describe('getFootballInjuryImpact', () => {
  afterEach(() => _resetCache());

  test('reads the cached league map with substring team match', async () => {
    _setTeams(new Map([
      ['kansas city chiefs', [
        { player: 'Patrick Mahomes', position: 'QB', status: 'Questionable' },
        { player: 'Some Punter', position: 'P', status: 'Out' },
      ]],
    ]));
    // No depth ranks supplied: every line is unknown rank at half weight.
    const r = await getFootballInjuryImpact('Chiefs');
    expect(r.impact).toBeCloseTo(-0.0085, 4);
    const full = await getFootballInjuryImpact('Chiefs', { unknownWeight: 1 });
    expect(full.impact).toBeCloseTo(-0.017, 4);
    expect(r.questionable).toBe(1);
    expect(r.out).toBe(1);
    expect(r.keyLoss).toContain('Mahomes');
  });

  test('team missing from the feed means a zero-impact report, not null', async () => {
    _setTeams(new Map([['dallas cowboys', []]]));
    const r = await getFootballInjuryImpact('Chicago Bears');
    expect(r.impact).toBe(0);
    expect(r.keyLoss).toBeNull();
  });

  test('feed unavailable returns null so the caller falls back', async () => {
    _resetCache();
    global.fetch = jest.fn().mockRejectedValue(new Error('down'));
    const r = await getFootballInjuryImpact('Chiefs');
    expect(r).toBeNull();
    delete global.fetch;
  });
});

describe('footballTotalPenalty', () => {
  test('wind bands and precipitation stack, domes are immune', () => {
    expect(footballTotalPenalty({ roof: 'none', wind_mph: 10, precip_chance_pct: 10 })).toBe(0);
    expect(footballTotalPenalty({ roof: 'none', wind_mph: 18, precip_chance_pct: 10 })).toBe(-2);
    expect(footballTotalPenalty({ roof: 'none', wind_mph: 27, precip_chance_pct: 80 })).toBe(-5.5);
    expect(footballTotalPenalty({ roof: 'dome', wind_mph: 30, precip_chance_pct: 90 })).toBe(0);
    expect(footballTotalPenalty(null)).toBe(0);
  });
});

describe('EdgeCalculator.restAdjustment', () => {
  const game = '2026-09-13T17:00:00Z';
  test('post-bye home team against a short-week away team', () => {
    // Home last played 14 days ago, away 4 days ago: +10 days of rest.
    const adj = EdgeCalculator.restAdjustment(game, '2026-08-30', '2026-09-09');
    expect(adj).toBeCloseTo(0.025, 5); // capped at 2.5pp
  });

  test('one day of differential is dropped as noise', () => {
    expect(EdgeCalculator.restAdjustment(game, '2026-09-06', '2026-09-07')).toBe(0);
  });

  test('missing or implausible rests return zero', () => {
    expect(EdgeCalculator.restAdjustment(game, null, '2026-09-06')).toBe(0);
    expect(EdgeCalculator.restAdjustment(game, '2026-09-12', '2026-09-06')).toBe(0); // 1 day rest
    expect(EdgeCalculator.restAdjustment(game, '2026-06-01', '2026-09-06')).toBe(0); // 104 days
  });
});

describe('injured reserve carries no weight (2026-09-12)', () => {
  const fi = require('../../lib/services/football-injuries');
  test('IR is zero, a game-day out still counts', () => {
    expect(fi.positionImpact('QB', 'injured reserve')).toBe(0);
    expect(fi.positionImpact('QB', 'IR')).toBe(0);
    expect(fi.positionImpact('QB', 'out')).toBeCloseTo(-0.06, 10);
  });
});

// Ops check 2026-10-02 and 10-03: 87 of 133 NFL injury entries carried
// depth_rank null, all or nothing per side and alphabetical (ARI to GB
// resolved, HOU onward not). One read of the view stops at PostgREST's
// 1000 row cap. The loader pages.
describe('loadDepthRanks pages past the 1000 row cap (2026-10-03)', () => {
  const { loadDepthRanks, splitScratchesByCost } = require('../../lib/services/football-injuries');
  function fakeView(rows, { failPage = null } = {}) {
    const calls = [];
    const chain = (from, to) => ({
      then(resolve) {
        calls.push([from, to]);
        if (failPage != null && calls.length === failPage) return resolve({ data: null, error: { message: 'boom' } });
        resolve({ data: rows.slice(from, to + 1), error: null });
      },
    });
    const q = {
      select: () => q, order: () => q,
      range: (from, to) => chain(from, to),
    };
    return { client: { from: () => q }, calls };
  }
  const rows = [];
  for (let t = 0; t < 32; t++) {
    const team = `T${String(t).padStart(2, '0')}`;
    for (let p = 0; p < 80; p++) rows.push({ team, espn_id: null, player_key: `player ${p}`, pos_abb: 'WR', best_rank: (p % 4) + 1 });
  }

  test('every club loads when the view spans three pages', async () => {
    _resetCache();
    const { client, calls } = fakeView(rows);
    const byTeam = await loadDepthRanks(client);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(byTeam.size).toBe(32);
    expect(lookupRank(byTeam, 'T31', { player: 'player 5', position: 'WR' })).toBe(2);
    expect(lookupRank(byTeam, 'T00', { player: 'player 0', position: 'WR' })).toBe(1);
  });

  test('a page failure keeps nothing partial', async () => {
    _resetCache();
    const { client } = fakeView(rows, { failPage: 2 });
    expect(await loadDepthRanks(client)).toBeNull();
  });

  test('splitScratchesByCost ignores a newly out player the chart prices at zero and keeps the rest', () => {
    _resetCache();
    const ranks = new Map([['PIT', new Map([['name:will howard|QB', 3], ['name:rico dowdle|RB', 2], ['name:aaron rodgers|QB', 1]])]]);
    const scratches = [
      { player: 'Will Howard', position: 'QB', from: 'not listed', to: 'out' },
      { player: 'Rico Dowdle', position: 'RB', from: 'questionable', to: 'out' },
      { player: 'Aaron Rodgers', position: 'QB', from: 'questionable', to: 'out' },
      { player: 'Nobody Known', position: 'WR', from: 'not listed', to: 'out' },
    ];
    const { priced, ignored } = splitScratchesByCost(scratches, 'PIT', ranks);
    expect(ignored.map(s => s.player)).toEqual(['Will Howard']);
    expect(priced.map(s => [s.player, s.depth_rank, s.depth_weight])).toEqual([
      ['Rico Dowdle', 2, 0.5], ['Aaron Rodgers', 1, 1], ['Nobody Known', null, 0.5],
    ]);
  });
});
