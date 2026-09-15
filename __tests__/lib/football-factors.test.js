const { positionImpact, teamImpact, getFootballInjuryImpact, depthWeight, lookupRank, _setTeams, _setDepthRanks, _resetCache } = require('../../lib/services/football-injuries');
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
  test('rank 1 full, rank 2 the dial, rank 3 and below nothing, unknown the other dial', () => {
    expect(depthWeight(1)).toBe(1);
    expect(depthWeight(2)).toBe(0.5);
    expect(depthWeight(2, { depth2: 0.25 })).toBe(0.25);
    expect(depthWeight(3)).toBe(0);
    expect(depthWeight(4)).toBe(0);
    expect(depthWeight(null)).toBe(0.5);
    expect(depthWeight(undefined, { unknown: 0 })).toBe(0);
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

  test('a third string quarterback out costs nothing and the starter costs 6pp', async () => {
    _setTeams(new Map([
      ['kansas city chiefs', [
        { player: 'Garrett Nussmeier', position: 'QB', status: 'Out', espnId: '999' },
      ]],
      ['green bay packers', [
        { player: 'Josh Jacobs', position: 'RB', status: 'Out', espnId: '4047365' },
        { player: 'Jordan Love', position: 'QB', status: 'Out' },
      ]],
    ]));
    const ranks = new Map([
      ['KC', new Map([['id:999', 3], ['name:garrett nussmeier', 3]])],
      // Jacobs is rank 4 on the newest chart but the window floor is 1.
      ['GB', new Map([['id:4047365', 1], ['name:josh jacobs', 1], ['name:jordan love|QB', 1], ['name:jordan love', 1]])],
    ]);
    const kc = await getFootballInjuryImpact('Kansas City Chiefs', { depthRanks: ranks });
    expect(kc.impact).toBe(0);
    expect(kc.out).toBe(1);
    expect(kc.lines[0]).toMatchObject({ depth_rank: 3, depth_weight: 0 });
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
