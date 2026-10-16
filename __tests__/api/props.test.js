const { shapeProps, showable, describe: say } = require('../../api/props');

const row = (o) => ({
  market: 'player_receptions', player_name: 'Puka Nacua', line: 5.5, v2_side: 'over', v2_edge_pp: 6,
  v2_outcome: 'pending', consensus_over_price: -115, consensus_under_price: -105, books: 7,
  commence_time: '2026-10-13T00:15:00Z', home_team: 'Buffalo Bills', away_team: 'Los Angeles Rams', actual_value: null, ...o,
});

describe('showable', () => {
  it('keeps 4pp and up, drops anytime TD no reads', () => {
    expect(showable(row())).toBe(true);
    expect(showable(row({ v2_edge_pp: 3.9 }))).toBe(false);
    expect(showable(row({ market: 'player_anytime_td', v2_side: 'under' }))).toBe(false);
    expect(showable(row({ market: 'player_anytime_td', v2_side: 'over' }))).toBe(true);
  });
});

describe('describe', () => {
  it('reads in plain words', () => {
    expect(say(row())).toBe('Puka Nacua over 5.5 receptions');
    expect(say(row({ market: 'player_anytime_td', player_name: 'Ty Johnson' }))).toBe('Ty Johnson to score a TD');
    expect(say(row({ market: 'player_rush_yds', v2_side: 'under', line: 36.5, player_name: 'Josh Allen' }))).toBe('Josh Allen under 36.5 rushing yards');
  });
});

describe('shapeProps', () => {
  it('sorts upcoming by edge and builds the record at the consensus price', () => {
    const up = [row({ v2_edge_pp: 5 }), row({ v2_edge_pp: 9, player_name: 'A' }), row({ v2_edge_pp: 2, player_name: 'B' })];
    const graded = [
      row({ v2_outcome: 'won', consensus_over_price: 120 }),
      row({ v2_outcome: 'lost' }),
      row({ market: 'player_rush_yds', v2_outcome: 'won', consensus_over_price: -110 }),
      row({ market: 'player_anytime_td', v2_side: 'under', v2_outcome: 'won' }),
    ];
    const out = shapeProps(up, [], graded);
    expect(out.upcoming.map(p => p.player)).toEqual(['A', 'Puka Nacua']);
    expect(out.record.total).toEqual({ won: 2, lost: 1, units: 1.1 });
    const rec = out.record.byMarket.find(m => m.market === 'player_receptions');
    expect(rec).toMatchObject({ won: 1, lost: 1, units: 0.2 });
  });

  it('lists recent graded reads with their outcome', () => {
    const out = shapeProps([], [row({ v2_outcome: 'won', actual_value: 7 }), row({ v2_outcome: 'pending' })], []);
    expect(out.recent).toHaveLength(1);
    expect(out.recent[0]).toMatchObject({ outcome: 'won', actual: 7 });
  });

  // Owner 2026-10-13: a read whose game started stays up, locked, with
  // its why, graded or not.
  it('keeps started reads in live with their why and outcome', () => {
    const live = [row({ v2_edge_pp: 5, narration: 'Volume is up.', narration_side: 'over', narration_line: 5.5 }), row({ v2_edge_pp: 3 })];
    const out = shapeProps([], [], [], live);
    expect(out.live).toHaveLength(1);
    expect(out.live[0]).toMatchObject({ started: true, outcome: 'pending' });
    expect(out.live[0].why.narration).toBe('Volume is up.');
    expect(shapeProps([], [], []).live).toEqual([]);
  });
});

// Owner 2026-10-16: a single 40 read cap across the slate left the Bears
// game with one read. The cap is per game now.
describe('per game cap', () => {
  const { capPerGame } = require('../../api/props');
  it('keeps every game on the board even when one game has the top edges', () => {
    const big = Array.from({ length: 45 }, (_, i) => row({ v2_edge_pp: 20 + i, player_name: `R${i}`, home_team: 'Los Angeles Rams', away_team: 'Arizona Cardinals' }));
    const bears = Array.from({ length: 10 }, (_, i) => row({ v2_edge_pp: 5 + i / 10, player_name: `B${i}`, home_team: 'Atlanta Falcons', away_team: 'Chicago Bears' }));
    const out = shapeProps([...big, ...bears], [], []);
    expect(out.upcoming.filter(p => p.away_team === 'Chicago Bears')).toHaveLength(10);
    expect(out.upcoming.filter(p => p.home_team === 'Los Angeles Rams')).toHaveLength(45);
    expect(out.upcoming[0].edgePp).toBe(64);
  });
  it('caps by game identity and keeps the given order', () => {
    const rows = [row({ player_name: 'x' }), row({ player_name: 'y' }), row({ player_name: 'z', home_team: 'Other' })];
    expect(capPerGame(rows, 1).map(r => r.player_name)).toEqual(['x', 'z']);
  });
});

// Owner 2026-10-16: every read shows under its game, the ones we would
// not bet as Skips with their numbers.
describe('skips', () => {
  const { skippable } = require('../../api/props');
  it('splits reads into props and skips', () => {
    const up = [
      row({ v2_edge_pp: 6, player_name: 'Play' }),
      row({ v2_edge_pp: 1.2, player_name: 'Close', narration: 'x', narration_side: 'over', narration_line: 5.5 }),
      row({ market: 'player_anytime_td', v2_side: 'under', v2_edge_pp: 7, player_name: 'NoTd' }),
      row({ market: 'player_kicking_points', v2_edge_pp: 2, player_name: 'Unlabeled' }),
    ];
    const live = [row({ v2_edge_pp: 2, player_name: 'Started' })];
    const out = shapeProps(up, [], [], live);
    expect(out.upcoming.map(p => p.player)).toEqual(['Play']);
    expect(out.skips.map(p => p.player)).toEqual(['NoTd', 'Started', 'Close']);
    const close = out.skips.find(p => p.player === 'Close');
    expect(close).toMatchObject({ skip: true, price: -115, line: 5.5, side: 'over' });
    expect(close.books).toBeUndefined();
    expect(out.skips.find(p => p.player === 'Started').started).toBe(true);
    expect(skippable(row({ v2_side: null }))).toBe(false);
  });
});

const { attachHistory, sideProbs } = require('../../api/props');

describe('anytime TD history', () => {
  it('counts games he scored even on a no lean', () => {
    const stats = [{ player_key: 'k', season: 2026, week: 1, rushing_tds: 1 }, { player_key: 'k', season: 2026, week: 2, rushing_tds: 0 }];
    const [p] = attachHistory([{ playerKey: 'k', market: 'player_anytime_td', side: 'under', line: 0.5 }], stats);
    expect(p.history.hits).toBe(1);
  });
});

describe('sideProbs', () => {
  it('turns stored over probabilities into the read side', () => {
    expect(sideProbs({ v2_side: 'over', v2_prob: 0.5452, anchor_prob: 0.4445 })).toEqual({ ourProb: 54.5, bookProb: 44.5 });
    expect(sideProbs({ v2_side: 'under', v2_prob: 0.4054, anchor_prob: 0.4993 })).toEqual({ ourProb: 59.5, bookProb: 50.1 });
    expect(sideProbs({ v2_side: 'over', v2_prob: null, anchor_prob: undefined })).toEqual({ ourProb: null, bookProb: null });
  });
});

describe('attachHistory', () => {
  const game = (week, o) => ({ player_key: 'dawson knox', season: 2026, week, team: 'BUF', opponent: 'NYJ', receptions: 2, ...o });
  it('keeps the last 10 games oldest first and counts hits on the read side', () => {
    const rows = Array.from({ length: 12 }, (_, i) => game(i + 1, { receptions: i % 3 }));
    const [p] = attachHistory([{ playerKey: 'dawson knox', market: 'player_receptions', side: 'over', line: 1.5 }], rows.reverse());
    expect(p.history.games.map(g => g.week)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(p.history.hits).toBe(4);
    expect(p.team).toBe('BUF');
  });
  it('reads unders and anytime TDs, and pushes are not hits', () => {
    const [u] = attachHistory([{ playerKey: 'dawson knox', market: 'player_receptions', side: 'under', line: 2 }], [game(1, { receptions: 2 }), game(2, { receptions: 1 })]);
    expect(u.history.games.map(g => g.hit)).toEqual([false, true]);
    const [td] = attachHistory([{ playerKey: 'dawson knox', market: 'player_anytime_td', side: 'over', line: 0.5 }], [game(1, { rushing_tds: 0, receiving_tds: 1 }), game(2, { rushing_tds: null, receiving_tds: 0 })]);
    expect(td.history.games.map(g => g.value)).toEqual([1, 0]);
    expect(td.history.hits).toBe(1);
  });
  it('leaves history null when the player has no games', () => {
    const [p] = attachHistory([{ playerKey: 'nobody', market: 'player_receptions', side: 'over', line: 1.5 }], [game(1)]);
    expect(p.history).toBeNull();
  });
});

describe('slim fields for the card', () => {
  it('carries both prices and short team codes', () => {
    const [p] = shapeProps([row({ consensus_over_price: 111, consensus_under_price: -146 })], [], []).upcoming;
    expect(p).toMatchObject({ overPrice: 111, underPrice: -146, awayAbbr: 'LA', homeAbbr: 'BUF' });
    const [td] = shapeProps([row({ market: 'player_anytime_td', consensus_over_price: 662, consensus_under_price: null })], [], []).upcoming;
    expect(td.underPrice).toBeNull();
  });
});
