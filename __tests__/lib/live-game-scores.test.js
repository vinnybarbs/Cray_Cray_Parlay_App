'use strict';

const {
  parseScoreboard, matchEvent, elapsedFraction, parsePick, standing, sideText, liveGames, _resetCache, CACHE_TTL_MS,
} = require('../../lib/services/live-game-scores.js');

// One ESPN site scoreboard event, the fields the tracker reads.
function event({ id = '401', date = '2026-10-16T00:15Z', home, away, hs, as, state = 'in', completed = false, period = 3, clock = '8:42', detail = '8:42 - 3rd', possession = null, downDistance = null, outs } = {}) {
  return {
    id, date,
    status: { period, displayClock: clock, type: { state, completed, detail, shortDetail: detail } },
    competitions: [{
      situation: { possession, shortDownDistanceText: downDistance, outs },
      competitors: [
        { id: '1', homeAway: 'home', score: String(hs), team: { id: '1', displayName: home, shortDisplayName: home.split(' ').pop(), abbreviation: home.split(' ').pop().slice(0, 3).toUpperCase() } },
        { id: '2', homeAway: 'away', score: String(as), team: { id: '2', displayName: away, abbreviation: away.split(' ').pop().slice(0, 3).toUpperCase() } },
      ],
    }],
  };
}

const PHI_NYG = { home: 'New York Giants', away: 'Philadelphia Eagles', hs: 14, as: 17, possession: '2', downDistance: '2nd & 7' };
const teams = { home_team: 'New York Giants', away_team: 'Philadelphia Eagles' };
const ev = (over = {}) => parseScoreboard({ events: [event({ ...PHI_NYG, ...over })] }, 'NFL')[0];

describe('parseScoreboard', () => {
  test('reads teams, scores, clock, possession and down and distance', () => {
    const e = ev();
    expect(e).toMatchObject({ state: 'in', final: false, period: 3, clock: '8:42', detail: '8:42 - 3rd', downDistance: '2nd & 7', possession: '2' });
    expect(e.home).toMatchObject({ name: 'New York Giants', score: 14 });
    expect(e.away).toMatchObject({ name: 'Philadelphia Eagles', score: 17, id: '2' });
  });

  test('a final is final, an event missing a side is dropped', () => {
    expect(ev({ state: 'post', completed: true }).final).toBe(true);
    const broken = { events: [{ id: '9', competitions: [{ competitors: [{ homeAway: 'home', team: { displayName: 'X' } }] }] }] };
    expect(parseScoreboard(broken, 'NFL')).toEqual([]);
  });
});

describe('matchEvent', () => {
  test('matches our names to ESPN names either way round and nearest the kickoff', () => {
    const events = [ev({ id: 'a', date: '2026-10-09T00:15Z' }), ev({ id: 'b', date: '2026-10-16T00:15Z' })];
    expect(matchEvent(events, 'New York Giants', 'Philadelphia Eagles', '2026-10-16T00:20Z').espnId).toBe('b');
    expect(matchEvent(events, 'NY Giants', 'Eagles', '2026-10-16T00:20Z')).toBeNull();
    expect(matchEvent(events, 'Giants', 'Eagles', '2026-10-16T00:20Z').espnId).toBe('b');
  });

  test('a kickoff more than 12 hours away is not our game', () => {
    expect(matchEvent([ev()], 'New York Giants', 'Philadelphia Eagles', '2026-10-18T00:15Z')).toBeNull();
  });
});

describe('elapsedFraction', () => {
  test('football: 8:42 left in the 3rd is 36.3 minutes of 60', () => {
    expect(elapsedFraction(ev())).toBeCloseTo((30 + 15 - 8.7) / 60, 3);
  });
  test('overtime and finals read as the whole game, a pregame as zero', () => {
    expect(elapsedFraction(ev({ period: 5 }))).toBe(1);
    expect(elapsedFraction(ev({ state: 'post' }))).toBe(1);
    expect(elapsedFraction(ev({ period: 1, clock: '15:00' }))).toBe(0);
  });
  test('baseball counts innings and halves', () => {
    const e = parseScoreboard({ events: [event({ ...PHI_NYG, period: 5, clock: null, detail: 'Top 5th' })] }, 'MLB')[0];
    expect(elapsedFraction(e)).toBeCloseTo(4 / 9, 3);
    const b = parseScoreboard({ events: [event({ ...PHI_NYG, period: 5, clock: null, detail: 'Bot 5th' })] }, 'MLB')[0];
    expect(elapsedFraction(b)).toBeCloseTo(4.5 / 9, 3);
  });
  test('a sport without a regulation table has no pace', () => {
    expect(elapsedFraction({ ...ev(), sport: 'UFC' })).toBeNull();
  });
});

describe('parsePick', () => {
  test('the three pick shapes the digest writes', () => {
    expect(parsePick('Philadelphia Eagles -3.5')).toEqual({ kind: 'spread', team: 'Philadelphia Eagles', line: -3.5 });
    expect(parsePick('Cleveland Browns +3.5 (-105)')).toEqual({ kind: 'spread', team: 'Cleveland Browns', line: 3.5 });
    expect(parsePick('Kansas City Chiefs ML -485')).toEqual({ kind: 'ml', team: 'Kansas City Chiefs' });
    expect(parsePick('Under 47.5')).toEqual({ kind: 'total', side: 'under', line: 47.5 });
    expect(parsePick('Over 51.5 (-115)')).toEqual({ kind: 'total', side: 'over', line: 51.5 });
    expect(parsePick('')).toBeNull();
  });
});

describe('standing: spreads', () => {
  test('a favorite covering says by how much and what it still needs', () => {
    const s = standing('Philadelphia Eagles -3.5', 'Spread', ev({ hs: 14, as: 21 }), teams);
    expect(s).toMatchObject({ status: 'ahead', label: 'Covering by 3.5', note: 'Needs to win by 4 or more' });
  });
  test('a favorite ahead but not covering is behind the number', () => {
    expect(standing('Philadelphia Eagles -3.5', 'Spread', ev(), teams)).toMatchObject({ status: 'behind', label: 'Not covering, 0.5 short' });
  });
  test('a dog getting points covers while losing small', () => {
    const s = standing('New York Giants +3.5', 'Spread', ev(), teams);
    expect(s).toMatchObject({ status: 'ahead', label: 'Covering by 0.5', note: 'Covers if it loses by 3 or less, or wins' });
    expect(standing('New York Giants +3', 'Spread', ev(), teams)).toMatchObject({ status: 'even', label: 'On the number', note: 'Covers if it loses by 2 or less, or wins' });
  });
  test('finals settle covered, missed or push', () => {
    const fin = (hs, as) => ev({ hs, as, state: 'post', completed: true });
    expect(standing('Philadelphia Eagles -3', 'Spread', fin(14, 21), teams)).toMatchObject({ status: 'won', label: 'Final, covered', note: 'Covered by 4' });
    expect(standing('Philadelphia Eagles -3', 'Spread', fin(14, 16), teams)).toMatchObject({ status: 'lost', label: 'Final, missed', note: 'Missed by 1' });
    expect(standing('Philadelphia Eagles -3', 'Spread', fin(14, 17), teams)).toMatchObject({ status: 'push', label: 'Final, push' });
  });
  test('a pick naming neither club is unknown', () => {
    expect(standing('Dallas Cowboys -3', 'Spread', ev(), teams)).toBeNull();
  });
});

describe('standing: moneylines', () => {
  test('ahead, behind, tied, then the final', () => {
    expect(standing('Philadelphia Eagles ML -150', 'Moneyline', ev(), teams)).toMatchObject({ status: 'ahead', label: 'Ahead by 3' });
    expect(standing('New York Giants ML +130', 'Moneyline', ev(), teams)).toMatchObject({ status: 'behind', label: 'Behind by 3', note: 'Needs to come back to win' });
    expect(standing('New York Giants ML +130', 'Moneyline', ev({ hs: 17 }), teams)).toMatchObject({ status: 'even', label: 'Tied' });
    expect(standing('New York Giants ML +130', 'Moneyline', ev({ state: 'post', completed: true }), teams)).toMatchObject({ status: 'lost', label: 'Final, lost', note: 'Lost by 3' });
    expect(standing('Philadelphia Eagles ML', 'Moneyline', ev({ state: 'post', completed: true }), teams)).toMatchObject({ status: 'won', label: 'Final, won' });
  });
});

describe('standing: totals', () => {
  test('an under still live has room and a pace', () => {
    const s = standing('Under 47.5', 'Total', ev({ hs: 10, as: 13, period: 2, clock: '3:15' }), teams);
    expect(s.status).toBe('ahead');
    expect(s.label).toBe('Under is live');
    expect(s.note).toMatch(/^Room for 24 more points, on pace for \d+$/);
    expect(s.pace).toBe(Math.round(23 / ((15 + 15 - 3.25) / 60)));
  });
  test('a whole number total pushes, so the room and the need shift by one', () => {
    expect(standing('Under 47', 'Total', ev({ hs: 10, as: 13 }), teams).note).toMatch(/^Room for 23 more points/);
    expect(standing('Over 47', 'Total', ev({ hs: 10, as: 13 }), teams).label).toBe('Over needs 25 points');
    expect(standing('Over 47.5', 'Total', ev({ hs: 10, as: 13 }), teams).label).toBe('Over needs 25 points');
    expect(standing('Over 23.5', 'Total', ev({ hs: 10, as: 13 }), teams).label).toBe('Over needs 1 point');
  });
  test('an over is won the moment it clears, an under lost the moment it goes over', () => {
    expect(standing('Over 30.5', 'Total', ev(), teams)).toMatchObject({ status: 'won', label: 'Over cleared' });
    expect(standing('Under 30.5', 'Total', ev(), teams)).toMatchObject({ status: 'lost', label: 'Under went over' });
  });
  test('finals: hit, missed and push', () => {
    const fin = ev({ state: 'post', completed: true }); // 31 points
    expect(standing('Under 31.5', 'Total', fin, teams)).toMatchObject({ status: 'won', label: 'Final, under hit' });
    expect(standing('Over 31.5', 'Total', fin, teams)).toMatchObject({ status: 'lost', label: 'Final, over missed' });
    expect(standing('Over 31', 'Total', fin, teams)).toMatchObject({ status: 'push' });
    expect(standing('Under 31', 'Total', fin, teams)).toMatchObject({ status: 'push' });
  });
  test('hockey counts goals and baseball runs', () => {
    const nhl = { ...ev({ hs: 2, as: 1, period: 2, clock: '10:00' }), sport: 'NHL' };
    expect(standing('Under 6.5', 'Total', nhl, teams).note).toMatch(/Room for 3 more goals/);
    const mlb = { ...ev({ hs: 2, as: 1 }), sport: 'MLB' };
    expect(standing('Over 8.5', 'Total', mlb, teams).label).toBe('Over needs 6 runs');
  });
  test('no score yet means no standing', () => {
    const e = ev();
    e.home.score = null;
    expect(standing('Over 40', 'Total', e, teams)).toBeNull();
  });
});

describe('sideText: the trap side in the board wording', () => {
  const game = { home_team: 'New York Giants', away_team: 'Philadelphia Eagles', spread: 3.5, total: 44.5 };
  test('each side the detector names', () => {
    expect(sideText(game, 'home_spread')).toBe('New York Giants +3.5');
    expect(sideText(game, 'away_spread')).toBe('Philadelphia Eagles -3.5');
    expect(sideText(game, 'away_ml')).toBe('Philadelphia Eagles ML');
    expect(sideText(game, 'over')).toBe('Over 44.5');
    expect(sideText({ ...game, total: null }, 'under')).toBeNull();
    expect(sideText(game, 'weird')).toBeNull();
  });
});

describe('liveGames', () => {
  beforeEach(() => _resetCache());
  const rows = [
    { game_key: 'nfl-1', sport: 'NFL', home_team: 'New York Giants', away_team: 'Philadelphia Eagles', game_date: '2026-10-16T00:15:00Z', spread: 3.5, total: 44.5,
      published_pick: { pick: 'Philadelphia Eagles -3.5', bet_type: 'Spread' },
      published_alts: [{ pick: 'Under 44.5', bet_type: 'Total' }],
      trap_calls: [{ side: 'home_ml' }] },
    { game_key: 'nfl-2', sport: 'NFL', home_team: 'Dallas Cowboys', away_team: 'Washington Commanders', game_date: '2026-10-16T00:15:00Z', published_pick: { pick: 'Dallas Cowboys ML -200', bet_type: 'Moneyline' } },
    { game_key: 'nfl-3', sport: 'NFL', home_team: 'Miami Dolphins', away_team: 'Buffalo Bills', game_date: '2026-10-16T00:15:00Z', published_pick: null, trap_calls: [] },
    { game_key: 'ufc-1', sport: 'UFC', home_team: 'A', away_team: 'B', game_date: '2026-10-16T00:15:00Z', published_pick: { pick: 'A ML -150', bet_type: 'Moneyline' } },
  ];
  const payload = { events: [event(PHI_NYG), event({ id: '402', home: 'Dallas Cowboys', away: 'Washington Commanders', hs: 20, as: 20, state: 'pre', period: 0, clock: '0:00' })] };
  const fetchFn = jest.fn(async (url) => ({ ok: true, json: async () => payload }));

  test('one scoreboard fetch per sport day, only tracked rows with a read, pregame games left out', async () => {
    const out = await liveGames(rows, { fetchFn, now: Date.parse('2026-10-16T01:00:00Z') });
    // NFL on the site day and the next day: two urls, one fetch each.
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls.every(([u]) => u.includes('/football/nfl/scoreboard?dates='))).toBe(true);
    expect(Object.keys(out.games)).toEqual(['nfl-1']);
    const g = out.games['nfl-1'];
    expect(g.home).toMatchObject({ name: 'New York Giants', short: 'Giants', score: 14, possession: false });
    expect(g.away).toMatchObject({ name: 'Philadelphia Eagles', score: 17, possession: true });
    expect(g.downDistance).toBe('2nd & 7');
    expect(g.pick).toMatchObject({ status: 'behind', label: 'Not covering, 0.5 short' });
    expect(g.alts['Under 44.5']).toMatchObject({ status: 'ahead', label: 'Under is live' });
    // The bait (Giants ML) is behind: read the other way round on the card.
    expect(g.traps.home_ml).toMatchObject({ status: 'behind', label: 'Behind by 3' });
    expect(out.asOf).toBe('2026-10-16T01:00:00.000Z');
  });

  test('a second call inside 30 seconds does not fetch again, after it does', async () => {
    fetchFn.mockClear();
    const t0 = Date.parse('2026-10-16T01:00:00Z');
    await liveGames(rows, { fetchFn, now: t0 });
    await liveGames(rows, { fetchFn, now: t0 + 10 * 1000 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await liveGames(rows, { fetchFn, now: t0 + CACHE_TTL_MS + 1 });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  test('ESPN down means an empty tracker, never a throw', async () => {
    const down = jest.fn(async () => { throw new Error('offline'); });
    const out = await liveGames(rows, { fetchFn: down, now: Date.now() });
    expect(out.games).toEqual({});
  });
});
