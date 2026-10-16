const { parseSummary, findPlayer, progressFor, liveProgress, clearCaches, keyFor } = require('../../lib/services/live-prop-stats');

// The ESPN summary shape (header status plus boxscore stat groups with
// keys, labels and per athlete string stats).
const summary = ({ state = 'in', completed = false, detail = '3rd 4:12' } = {}) => ({
  header: {
    competitions: [{
      status: { type: { state, completed, shortDetail: detail } },
      competitors: [
        { homeAway: 'home', score: '14', team: { abbreviation: 'SF', displayName: 'San Francisco 49ers' } },
        { homeAway: 'away', score: '17', team: { abbreviation: 'LAR', displayName: 'Los Angeles Rams' } },
      ],
    }],
  },
  boxscore: {
    players: [{
      team: { abbreviation: 'LAR' },
      statistics: [
        {
          name: 'passing',
          keys: ['completions/passingAttempts', 'passingYards', 'yardsPerPassAttempt', 'passingTouchdowns', 'interceptions'],
          labels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT'],
          athletes: [{ athlete: { displayName: 'Matthew Stafford' }, stats: ['18/25', '211', '8.4', '2', '0'] }],
        },
        {
          name: 'rushing',
          keys: ['rushingAttempts', 'rushingYards', 'yardsPerRushAttempt', 'rushingTouchdowns', 'longRushing'],
          labels: ['CAR', 'YDS', 'AVG', 'TD', 'LONG'],
          athletes: [{ athlete: { displayName: 'Kyren Williams' }, stats: ['14', '61', '4.4', '1', '12'] }],
        },
        {
          name: 'receiving',
          labels: ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS'],
          athletes: [
            { athlete: { displayName: 'Puka Nacua' }, stats: ['4', '58', '14.5', '0', '22', '6'] },
            { athlete: { displayName: 'Kyren Williams' }, stats: ['2', '11', '5.5', '1', '8', '2'] },
          ],
        },
      ],
    }],
  },
});

const read = (o) => ({
  player: 'Puka Nacua', playerKey: 'P1', market: 'player_receptions', side: 'over', line: 6.5,
  home_team: 'San Francisco 49ers', away_team: 'Los Angeles Rams', commence_time: '2026-10-16T00:15:00Z', ...o,
});

describe('parseSummary', () => {
  it('reads the game state and merges stat groups per player', () => {
    const { game, players } = parseSummary(summary());
    expect(game).toMatchObject({ state: 'in', final: false, detail: '3rd 4:12', homeScore: 14, awayScore: 17, awayAbbr: 'LAR' });
    expect(findPlayer(players, 'Puka Nacua')).toMatchObject({ receptions: 4, receiving_yards: 58 });
    expect(findPlayer(players, 'Kyren Williams')).toMatchObject({ rushing_yards: 61, rushing_tds: 1, receiving_tds: 1, receptions: 2 });
    expect(findPlayer(players, 'Matthew Stafford')).toMatchObject({ passing_yards: 211, passing_tds: 2 });
  });

  it('matches suffixes and a unique initial plus last name', () => {
    const { players } = parseSummary(summary());
    expect(findPlayer(players, 'Puka Nacua Jr.')).toBeTruthy();
    expect(findPlayer(players, 'K. Williams')).toBeTruthy();
    expect(findPlayer(players, 'Cooper Kupp')).toBeNull();
  });
});

describe('progressFor', () => {
  const live = parseSummary(summary());
  const final = parseSummary(summary({ state: 'post', completed: true, detail: 'Final' }));

  it('shows an open over in progress', () => {
    expect(progressFor(read(), live.game, live.players)).toEqual({ current: 4, status: 'live', final: false });
  });

  it('calls an over a hit the moment it clears, even mid game', () => {
    expect(progressFor(read({ line: 3.5 }), live.game, live.players).status).toBe('hit');
  });

  it('calls an under a miss the moment it goes over', () => {
    expect(progressFor(read({ side: 'under', line: 3.5 }), live.game, live.players).status).toBe('miss');
    expect(progressFor(read({ side: 'under', line: 6.5 }), live.game, live.players).status).toBe('live');
  });

  it('settles at the final whistle', () => {
    expect(progressFor(read(), final.game, final.players).status).toBe('miss');
    expect(progressFor(read({ side: 'under' }), final.game, final.players).status).toBe('hit');
    expect(progressFor(read({ line: 4 }), final.game, final.players).status).toBe('push');
  });

  it('counts rushing plus receiving scores for anytime TD', () => {
    const td = read({ player: 'Kyren Williams', market: 'player_anytime_td', line: 0.5 });
    expect(progressFor(td, live.game, live.players)).toMatchObject({ current: 2, status: 'hit' });
    expect(progressFor(read({ market: 'player_anytime_td', line: 0.5 }), live.game, live.players).status).toBe('live');
    expect(progressFor(read({ market: 'player_anytime_td', line: 0.5 }), final.game, final.players).status).toBe('miss');
  });

  it('a player with no line is zero while live and no_stats at the final', () => {
    const r = read({ player: 'Cooper Kupp' });
    expect(progressFor(r, live.game, live.players)).toMatchObject({ current: 0, status: 'live' });
    expect(progressFor(r, final.game, final.players).status).toBe('no_stats');
  });
});

describe('liveProgress', () => {
  beforeEach(clearCaches);

  const fakeFetch = (payload) => jest.fn(async (url) => {
    if (url.includes('/scoreboard')) {
      return {
        ok: true,
        json: async () => ({
          events: [{
            id: '401', date: '2026-10-16T00:15:00Z',
            competitions: [{ competitors: [
              { homeAway: 'home', team: { displayName: 'San Francisco 49ers' } },
              { homeAway: 'away', team: { displayName: 'Los Angeles Rams' } },
            ] }],
          }],
        }),
      };
    }
    return { ok: true, json: async () => payload };
  });

  it('finds the event, keys progress by read and caches the summary', async () => {
    const fetchFn = fakeFetch(summary());
    const r = read();
    const out = await liveProgress([r, read({ line: 3.5 })], { fetchFn, now: 1000 });
    expect(out.reads[keyFor(r)]).toMatchObject({ current: 4, status: 'live' });
    expect(Object.keys(out.games)).toHaveLength(1);
    const calls = fetchFn.mock.calls.length;
    await liveProgress([r], { fetchFn, now: 5000 });
    expect(fetchFn.mock.calls.length).toBe(calls);
  });

  it('skips a game ESPN still has as pre', async () => {
    const out = await liveProgress([read()], { fetchFn: fakeFetch(summary({ state: 'pre' })), now: 1 });
    expect(out).toEqual({ games: {}, reads: {} });
  });
});
