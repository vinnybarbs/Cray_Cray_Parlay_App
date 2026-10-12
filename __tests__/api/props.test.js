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
});
