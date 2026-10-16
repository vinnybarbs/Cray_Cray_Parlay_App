const { gameItemKey, propItemKey, gameItem, propItem, mergeTracked, pruneTracked, itemSection, splitTracked } = require('../../src/lib/trackedKeys');

const NOW = Date.parse('2026-10-16T02:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString();

describe('tracked keys and items', () => {
  it('keys a play by game and pick text, a prop by the live read key plus kickoff', () => {
    expect(gameItemKey('nfl_x', 'Eagles -3')).toBe('game:nfl_x:Eagles -3');
    expect(propItemKey({ playerKey: 'puka nacua', market: 'player_receptions', side: 'over', line: 6.5, commence_time: '2026-10-16T00:15Z' }))
      .toBe('prop:puka nacua|player_receptions|over|6.5|2026-10-16T00:15Z');
  });

  it('snapshots the fields the Tracked page renders from', () => {
    const game = { sport: 'NFL', home_team: 'Giants', away_team: 'Eagles', game_date: '2026-10-16T00:15Z' };
    const it = gameItem(game, 'nfl_x', { pick: 'Eagles -3', bet_type: 'spread', odds: -110, tier: 'Play', edge_pp: 4.2 }, { book: 50, ours: 56 });
    expect(it).toMatchObject({ kind: 'game', key: 'game:nfl_x:Eagles -3', pick: 'Eagles -3', book_pct: 50, our_pct: 56, sport: 'NFL' });
    const p = propItem({ player: 'Puka Nacua', playerKey: 'puka nacua', market: 'player_receptions', side: 'over', line: 6.5, price: -115, commence_time: '2026-10-16T00:15Z', home_team: 'Giants', away_team: 'Rams', ourProb: 0.6, bookProb: 0.52 });
    expect(p).toMatchObject({ kind: 'prop', player: 'Puka Nacua', line: 6.5, ourProb: 0.6 });
  });
});

describe('mergeTracked and pruneTracked', () => {
  it('unions by key, newest tracked_at wins, newest kickoff first', () => {
    const a = [{ key: 'k1', kind: 'game', game_date: hoursAgo(1), tracked_at: '2026-10-15T00:00Z', pick: 'old' }];
    const b = [
      { key: 'k1', kind: 'game', game_date: hoursAgo(1), tracked_at: '2026-10-16T00:00Z', pick: 'new' },
      { key: 'k2', kind: 'prop', commence_time: hoursAgo(-3), tracked_at: '2026-10-16T00:00Z' },
    ];
    const m = mergeTracked(a, b);
    expect(m.map(x => x.key)).toEqual(['k2', 'k1']);
    expect(m[1].pick).toBe('new');
  });

  it('drops games older than a week', () => {
    const list = [{ key: 'old', kind: 'game', game_date: hoursAgo(24 * 8) }, { key: 'new', kind: 'game', game_date: hoursAgo(2) }];
    expect(pruneTracked(list, NOW).map(x => x.key)).toEqual(['new']);
  });
});

describe('itemSection and splitTracked', () => {
  it('uses the grade and the live final flag before the clock', () => {
    const it = { kind: 'game', game_date: hoursAgo(1) };
    expect(itemSection(it, {}, NOW)).toBe('live');
    expect(itemSection(it, { final: true }, NOW)).toBe('finished');
    expect(itemSection(it, { outcome: 'won' }, NOW)).toBe('finished');
    expect(itemSection({ kind: 'game', game_date: hoursAgo(-2) }, {}, NOW)).toBe('upcoming');
    expect(itemSection({ kind: 'prop', commence_time: hoursAgo(6) }, {}, NOW)).toBe('finished');
  });

  it('orders upcoming soonest first and finished latest first', () => {
    const list = [
      { key: 'u2', kind: 'game', game_date: hoursAgo(-5) },
      { key: 'u1', kind: 'game', game_date: hoursAgo(-1) },
      { key: 'f1', kind: 'game', game_date: hoursAgo(30) },
      { key: 'f2', kind: 'game', game_date: hoursAgo(10) },
      { key: 'l1', kind: 'prop', commence_time: hoursAgo(1) },
    ];
    const s = splitTracked(list, () => ({}), NOW);
    expect(s.upcoming.map(x => x.key)).toEqual(['u1', 'u2']);
    expect(s.finished.map(x => x.key)).toEqual(['f2', 'f1']);
    expect(s.live.map(x => x.key)).toEqual(['l1']);
  });
});
