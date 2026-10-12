const { csvStream, redzoneAccumulator } = require('../../lib/services/nfl-redzone');
const pe = require('../../lib/services/prop-edge');

describe('csvStream', () => {
  it('handles quotes, commas and rows split across chunks', () => {
    const rows = [];
    const r = csvStream(c => rows.push(c));
    r.push('a,"b, c",d\n1,"he said ""hi""",');
    r.push('3\r\n4,5,6');
    r.end();
    expect(rows).toEqual([['a', 'b, c', 'd'], ['1', 'he said "hi"', '3'], ['4', '5', '6']]);
  });

  it('keeps a quote that closes at a chunk edge', () => {
    const rows = [];
    const r = csvStream(c => rows.push(c));
    r.push('"x"');
    r.push(',y\n');
    r.end();
    expect(rows).toEqual([['x', 'y']]);
  });
});

describe('redzoneAccumulator', () => {
  const play = (o) => ({ game_id: 'G1', season: '2026', week: '3', season_type: 'REG', posteam: 'DET',
    two_point_attempt: '0', sack: '0', touchdown: '0', td_player_id: 'NA', ...o });
  it('counts red zone and goal line usage, skips two point tries and sacks', () => {
    const acc = redzoneAccumulator();
    acc.add(play({ yardline_100: '3', rush_attempt: '1', rusher_player_id: 'RB1', touchdown: '1', td_player_id: 'RB1' }));
    acc.add(play({ yardline_100: '15', rush_attempt: '1', rusher_player_id: 'RB1' }));
    acc.add(play({ yardline_100: '35', rush_attempt: '1', rusher_player_id: 'RB1' }));
    acc.add(play({ yardline_100: '2', rush_attempt: '1', rusher_player_id: 'RB1', two_point_attempt: '1' }));
    acc.add(play({ yardline_100: '12', pass_attempt: '1', receiver_player_id: 'WR1', air_yards: '12' }));
    acc.add(play({ yardline_100: '12', pass_attempt: '1', receiver_player_id: 'WR1', air_yards: '4' }));
    acc.add(play({ yardline_100: '8', pass_attempt: '1', sack: '1', receiver_player_id: 'NA' }));
    const rows = Object.fromEntries(acc.rows().map(r => [r.player_id, r]));
    expect(rows.RB1).toMatchObject({ rz_carries: 2, gl_carries: 1, rz_rush_tds: 1, team_rz_carries: 2, team_rz_targets: 2 });
    expect(rows.WR1).toMatchObject({ rz_targets: 2, ez_targets: 1, rz_rec_tds: 0 });
  });
});

describe('anytime TD model', () => {
  it('values goal line work far above work outside the 20', () => {
    const gl = pe.tdLambdaGame({ carries: 5, gl_carries: 2, rz_carries: 2 });
    const field = pe.tdLambdaGame({ carries: 5 });
    expect(gl).toBeGreaterThan(field * 5);
  });

  it('turns usage into P(at least one)', () => {
    const b = pe.tdBaseline([{ carries: 15, targets: 3, rz_carries: 3, gl_carries: 1, rz_targets: 1, ez_targets: 1 }]);
    expect(b.prob).toBeCloseTo(1 - Math.exp(-b.lambda), 10);
    expect(b.prob).toBeGreaterThan(0.4);
    expect(pe.tdBaseline([])).toBeNull();
  });

  it('anchors on the median yes price with the vig left in', () => {
    const c = pe.yesConsensus([{ bookmaker: 'a', yes_price: 150 }, { bookmaker: 'b', yes_price: 130 }, { bookmaker: 'c', yes_price: 140 }]);
    expect(c.books).toBe(3);
    expect(c.prob).toBeCloseTo(100 / 240, 6);
    expect(c.price).toBe(140);
    expect(c.best).toEqual({ book: 'a', price: 150 });
    expect(pe.yesConsensus([])).toBeNull();
  });

  it('damps toward the anchor and picks the side', () => {
    const baseline = { prob: 0.5, games: 10 };
    const r = pe.tdRead({ anchorYesProb: 0.3, baseline });
    expect(r.side).toBe('over');
    expect(r.edgePp).toBe(10);
    expect(pe.tdRead({ anchorYesProb: 0.6, baseline }).side).toBe('under');
    expect(pe.tdRead({ anchorYesProb: null, baseline })).toBeNull();
  });
});

describe('analyze-nfl-props tdRow', () => {
  const { tdRow } = require('../../api/cron/analyze-nfl-props');
  const meta = { event_id: 'E1', commence_time: '2026-10-19T17:00:00Z', home_team: 'Detroit Lions', away_team: 'Chicago Bears',
    market: 'player_anytime_td', player_key: 'jahmyr gibbs', player_name: 'Jahmyr Gibbs' };
  const rows = [{ bookmaker: 'a', yes_price: -150 }, { bookmaker: 'b', yes_price: -140 }];
  const history = new Map([['jahmyr gibbs', Array.from({ length: 6 }, (_, i) => ({ game_id: `G${i}`, player_id: 'P1', carries: 16, targets: 4 }))]]);
  const redzone = new Map(Array.from({ length: 6 }, (_, i) => [`G${i}|P1`, { rz_carries: 4, gl_carries: 2, rz_targets: 1, ez_targets: 1 }]));
  const dials = { prop_min_books: 2 };

  it('writes an over 0.5 row with both read columns filled', () => {
    const tally = { no_usage_table: 0, thin_books: 0, no_history: 0 };
    const r = tdRow(meta, rows, history, redzone, true, dials, tally);
    expect(r).toMatchObject({ market: 'player_anytime_td', line: 0.5, books: 2, v2_outcome: 'pending' });
    expect(r.side).toBe(r.v2_side);
    expect(r.edge_pp).toBe(r.v2_edge_pp);
    expect(r.factors.model).toBe('usage');
  });

  it('skips when the usage table is empty or books are thin', () => {
    const tally = { no_usage_table: 0, thin_books: 0, no_history: 0 };
    expect(tdRow(meta, rows, history, redzone, false, dials, tally)).toBeNull();
    expect(tdRow(meta, rows.slice(0, 1), history, redzone, true, dials, tally)).toBeNull();
    expect(tally).toMatchObject({ no_usage_table: 1, thin_books: 1 });
  });
});
