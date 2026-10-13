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

const { attachHistory, sideProbs } = require('../../api/props');

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
