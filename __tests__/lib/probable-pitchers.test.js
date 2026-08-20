const { getProbablePitchersText, getProbablePitcherStats, starterEraAdjustment, _resetCache } = require('../../lib/services/probable-pitchers');

function espnPayload() {
  return {
    events: [
      {
        competitions: [
          {
            competitors: [
              {
                homeAway: 'home',
                team: { displayName: 'Colorado Rockies' },
                probables: [
                  {
                    athlete: { displayName: 'Kyle Freeland' },
                    statistics: [
                      { abbreviation: 'W-L', displayValue: '5-9' },
                      { abbreviation: 'ERA', displayValue: '5.24' },
                    ],
                  },
                ],
              },
              {
                homeAway: 'away',
                team: { displayName: 'San Francisco Giants' },
                probables: [
                  {
                    athlete: { displayName: 'Logan Webb' },
                    record: '12-7, 3.01 ERA',
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        competitions: [
          {
            competitors: [
              {
                homeAway: 'home',
                team: { displayName: 'New York Yankees' },
                probables: [{ athlete: { displayName: 'Max Fried' } }],
              },
              {
                homeAway: 'away',
                team: { displayName: 'Boston Red Sox' },
                // No probable announced yet for the away side.
                probables: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('getProbablePitchersText', () => {
  beforeEach(() => {
    _resetCache();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => espnPayload(),
    });
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('builds the away vs home line with stat notes', async () => {
    const text = await getProbablePitchersText('Colorado Rockies', 'San Francisco Giants');
    expect(text).toBe(
      'Logan Webb (12-7, 3.01 ERA) for San Francisco Giants vs Kyle Freeland (5-9 W-L, 5.24 ERA) for Colorado Rockies'
    );
  });

  test('handles a one-sided announcement', async () => {
    const text = await getProbablePitchersText('New York Yankees', 'Boston Red Sox');
    expect(text).toBe('Max Fried for New York Yankees');
  });

  test('substring fallback matches shortened team names', async () => {
    const text = await getProbablePitchersText('Rockies', 'Giants');
    expect(text).toContain('Logan Webb');
    expect(text).toContain('Kyle Freeland');
  });

  test('returns null for an unknown matchup', async () => {
    const text = await getProbablePitchersText('Chicago Cubs', 'Milwaukee Brewers');
    expect(text).toBeNull();
  });

  test('caches the slate across calls', async () => {
    await getProbablePitchersText('Colorado Rockies', 'San Francisco Giants');
    await getProbablePitchersText('New York Yankees', 'Boston Red Sox');
    // Two site days fetched once, then served from cache.
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('fails soft when ESPN errors', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('espn down'));
    const text = await getProbablePitchersText('Colorado Rockies', 'San Francisco Giants');
    expect(text).toBeNull();
  });

  test('fails soft on a non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502 });
    const text = await getProbablePitchersText('Colorado Rockies', 'San Francisco Giants');
    expect(text).toBeNull();
  });

  test('structured stats parse ERA from statistics and record strings', async () => {
    const stats = await getProbablePitcherStats('Colorado Rockies', 'San Francisco Giants');
    expect(stats.home.name).toBe('Kyle Freeland');
    expect(stats.home.era).toBeCloseTo(5.24, 2);
    // Webb's ERA comes from the "12-7, 3.01 ERA" record-string fallback.
    expect(stats.away.name).toBe('Logan Webb');
    expect(stats.away.era).toBeCloseTo(3.01, 2);
  });

  test('one-sided announcement yields a null side', async () => {
    const stats = await getProbablePitcherStats('New York Yankees', 'Boston Red Sox');
    expect(stats.home.name).toBe('Max Fried');
    expect(stats.home.era).toBeNull();
    expect(stats.away).toBeNull();
  });
});

describe('starterEraAdjustment', () => {
  test('better home starter moves probability home, capped at 6pp', () => {
    expect(starterEraAdjustment(3.01, 5.24)).toBeCloseTo(0.06, 5);
    expect(starterEraAdjustment(3.5, 4.5)).toBeCloseTo(0.04, 5);
    expect(starterEraAdjustment(4.5, 3.5)).toBeCloseTo(-0.04, 5);
  });

  test('returns zero unless both ERAs are known and sane', () => {
    expect(starterEraAdjustment(null, 4.5)).toBe(0);
    expect(starterEraAdjustment(3.5, null)).toBe(0);
    expect(starterEraAdjustment(0, 4.5)).toBe(0);
    expect(starterEraAdjustment(3.5, 27)).toBe(0);
  });
});
