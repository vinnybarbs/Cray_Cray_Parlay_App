const { positionImpact, teamImpact, getFootballInjuryImpact, _setTeams, _resetCache } = require('../../lib/services/football-injuries');
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

describe('getFootballInjuryImpact', () => {
  afterEach(() => _resetCache());

  test('reads the cached league map with substring team match', async () => {
    _setTeams(new Map([
      ['kansas city chiefs', [
        { player: 'Patrick Mahomes', position: 'QB', status: 'Questionable' },
        { player: 'Some Punter', position: 'P', status: 'Out' },
      ]],
    ]));
    const r = await getFootballInjuryImpact('Chiefs');
    expect(r.impact).toBeCloseTo(-0.017, 4);
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
