const {
  buildRatingTable,
  ratingFromTable,
  seedEloFromPoints,
  expectedScore,
  createRatingsProvider,
  getTennisCalibrationMultiplier,
  _resetCache,
  UNRANKED_SEED,
  MIN_MATCHES_UNRANKED,
} = require('../../lib/services/tennis-ratings');

const NOW = new Date('2026-08-25T12:00:00Z');

describe('seedEloFromPoints', () => {
  test('more points means a higher seed', () => {
    expect(seedEloFromPoints(12000)).toBeGreaterThan(seedEloFromPoints(1200));
    expect(seedEloFromPoints(1200)).toBeGreaterThan(seedEloFromPoints(400));
  });

  test('top of tour lands in a plausible Elo range', () => {
    const top = seedEloFromPoints(12000);
    expect(top).toBeGreaterThan(2150);
    expect(top).toBeLessThan(2400);
  });

  test('junk points give null', () => {
    expect(seedEloFromPoints(null)).toBeNull();
    expect(seedEloFromPoints(0)).toBeNull();
    expect(seedEloFromPoints(-5)).toBeNull();
    expect(seedEloFromPoints('nope')).toBeNull();
  });
});

describe('buildRatingTable', () => {
  const rankings = [
    { tour: 'atp', player_key: 'carlos alcaraz', points: 9000 },
    { tour: 'atp', player_key: 'fabian marozsan', points: 1100 },
    { tour: 'wta', player_key: 'iga swiatek', points: 8000 },
  ];

  test('a win moves the winner up and the loser down by the same amount', () => {
    const table = buildRatingTable({
      rankings,
      matches: [{ id: 1, tour: 'atp', match_date: '2026-08-20', winner_key: 'fabian marozsan', loser_key: 'carlos alcaraz', finish_type: 'completed' }],
      now: NOW,
    });
    const upset = table.get('atp|fabian marozsan');
    const fav = table.get('atp|carlos alcaraz');
    expect(upset.elo).toBeGreaterThan(seedEloFromPoints(1100));
    expect(fav.elo).toBeLessThan(seedEloFromPoints(9000));
    const gained = upset.elo - seedEloFromPoints(1100);
    const lost = seedEloFromPoints(9000) - fav.elo;
    expect(gained).toBeCloseTo(lost, 6);
    // An upset over a much higher seed pays close to the full K.
    expect(gained).toBeGreaterThan(20);
  });

  test('a walkover moves nothing and counts no workload', () => {
    const table = buildRatingTable({
      rankings,
      matches: [{ id: 1, tour: 'atp', match_date: '2026-08-20', winner_key: 'fabian marozsan', loser_key: 'carlos alcaraz', finish_type: 'walkover' }],
      now: NOW,
    });
    expect(table.get('atp|fabian marozsan').elo).toBeCloseTo(seedEloFromPoints(1100), 6);
    expect(table.get('atp|fabian marozsan').matchesLast14).toBe(0);
  });

  test('matches replay in date order regardless of input order', () => {
    const shuffled = [
      { id: 2, tour: 'atp', match_date: '2026-08-21', winner_key: 'carlos alcaraz', loser_key: 'fabian marozsan', finish_type: 'completed' },
      { id: 1, tour: 'atp', match_date: '2026-08-10', winner_key: 'fabian marozsan', loser_key: 'carlos alcaraz', finish_type: 'completed' },
    ];
    const table = buildRatingTable({ rankings, matches: shuffled, now: NOW });
    const rematch = buildRatingTable({ rankings, matches: [...shuffled].reverse(), now: NOW });
    expect(table.get('atp|carlos alcaraz').elo).toBeCloseTo(rematch.get('atp|carlos alcaraz').elo, 9);
  });

  test('workload window counts only the trailing 14 days', () => {
    const table = buildRatingTable({
      rankings,
      matches: [
        { id: 1, tour: 'wta', match_date: '2026-08-24', winner_key: 'iga swiatek', loser_key: 'somebody new', finish_type: 'completed' },
        { id: 2, tour: 'wta', match_date: '2026-07-01', winner_key: 'iga swiatek', loser_key: 'somebody new', finish_type: 'completed' },
      ],
      now: NOW,
    });
    const iga = table.get('wta|iga swiatek');
    expect(iga.matches).toBe(2);
    expect(iga.matchesLast14).toBe(1);
    expect(iga.lastMatchDate).toBe('2026-08-24');
  });

  test('tours never share ratings even on a colliding key', () => {
    const table = buildRatingTable({
      rankings: [
        { tour: 'atp', player_key: 'alex smith', points: 5000 },
        { tour: 'wta', player_key: 'alex smith', points: 500 },
      ],
      matches: [],
      now: NOW,
    });
    expect(table.get('atp|alex smith').elo).toBeGreaterThan(table.get('wta|alex smith').elo);
  });
});

describe('ratingFromTable', () => {
  const table = buildRatingTable({
    rankings: [{ tour: 'atp', player_key: 'fabian marozsan', points: 1100 }],
    matches: [
      { id: 1, tour: 'atp', match_date: '2026-08-18', winner_key: 'lucky qualifier', loser_key: 'fabian marozsan', finish_type: 'completed' },
      { id: 2, tour: 'atp', match_date: '2026-08-19', winner_key: 'lucky qualifier', loser_key: 'fabian marozsan', finish_type: 'completed' },
    ],
    now: NOW,
  });

  test('accent and case differences still find the player', () => {
    const r = ratingFromTable(table, { name: 'Fábián Marozsán', tour: 'ATP' });
    expect(r).not.toBeNull();
    expect(r.surfaceElo).toBeNull();
    expect(r.matchesLast14).toBe(2);
  });

  test('an unranked player below the match floor gets no rating', () => {
    expect(MIN_MATCHES_UNRANKED).toBeGreaterThan(2);
    expect(ratingFromTable(table, { name: 'Lucky Qualifier', tour: 'atp' })).toBeNull();
  });

  test('an unranked player at the match floor gets the default seed region', () => {
    const busy = buildRatingTable({
      rankings: [],
      matches: [1, 2, 3].map((i) => ({
        id: i, tour: 'atp', match_date: `2026-08-2${i}`,
        winner_key: 'lucky qualifier', loser_key: `opponent ${i}`, finish_type: 'completed',
      })),
      now: NOW,
    });
    const r = ratingFromTable(busy, { name: 'Lucky Qualifier', tour: 'atp' });
    expect(r).not.toBeNull();
    expect(r.elo).toBeGreaterThan(UNRANKED_SEED);
  });

  test('unknown player gives null', () => {
    expect(ratingFromTable(table, { name: 'Nobody Athletic', tour: 'atp' })).toBeNull();
  });
});

describe('expectedScore', () => {
  test('equal ratings expect a coin flip', () => {
    expect(expectedScore(1800, 1800)).toBeCloseTo(0.5, 9);
  });
  test('400 points of Elo expect about 91 percent', () => {
    expect(expectedScore(2200, 1800)).toBeCloseTo(0.909, 2);
  });
});

describe('production provider and multiplier', () => {
  afterEach(() => _resetCache());

  function fakeSupabase({ rankings = [], matches = [], calRows = [], failTables = false }) {
    return {
      from(tableName) {
        return {
          select() {
            if (tableName === 'edge_calibration') {
              return {
                in: async () => ({ data: calRows, error: null }),
              };
            }
            if (failTables) return Promise.resolve({ data: null, error: new Error('down') });
            if (tableName === 'tennis_rankings') return Promise.resolve({ data: rankings, error: null });
            if (tableName === 'tennis_match_results') return Promise.resolve({ data: matches, error: null });
            return Promise.resolve({ data: [], error: null });
          },
        };
      },
    };
  }

  test('provider serves ratings from the stored tables', async () => {
    const provider = createRatingsProvider(fakeSupabase({
      rankings: [{ tour: 'atp', player_key: 'carlos alcaraz', points: 9000 }],
    }));
    const r = await provider.getRating({ name: 'Carlos Alcaraz', tour: 'atp' });
    expect(r.elo).toBeCloseTo(seedEloFromPoints(9000), 6);
  });

  test('a table outage degrades to no ratings, never throws', async () => {
    const provider = createRatingsProvider(fakeSupabase({ failTables: true }));
    await expect(provider.getRating({ name: 'Carlos Alcaraz', tour: 'atp' })).resolves.toBeNull();
  });

  test('multiplier prefers Tennis:ml, falls back to Tennis, then 1', async () => {
    expect(await getTennisCalibrationMultiplier(fakeSupabase({
      calRows: [{ key: 'Tennis:ml', multiplier: '0.8' }, { key: 'Tennis', multiplier: '0.3' }],
    }))).toBe(0.8);
    _resetCache();
    expect(await getTennisCalibrationMultiplier(fakeSupabase({
      calRows: [{ key: 'Tennis', multiplier: '0.3' }],
    }))).toBe(0.3);
    _resetCache();
    expect(await getTennisCalibrationMultiplier(fakeSupabase({ calRows: [] }))).toBe(1);
  });
});
