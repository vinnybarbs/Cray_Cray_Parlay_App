// The weekly dial search: the variant grid, the stage 1 winners, and the
// two stage run on a mocked replay.

jest.mock('../../lib/replay/replay-formula.js', () => ({
  runReplay: jest.fn(),
  runHistoryReplay: jest.fn(async (_s, opts) => ({ formulas: Object.fromEntries(opts.variants.map(v => [v.name, { picks: 0, won: 0, lost: 0, units: 0 }])), games_with_results: 0, games_unmatched: 0 })),
  priorSeasonWindows: () => [{ since: '2025-08-01T00:00:00Z', until: '2025-10-13T00:00:00Z' }],
  siteDate: (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Denver' }),
}));
const { runReplay, runHistoryReplay } = require('../../lib/replay/replay-formula.js');
const ds = require('../../lib/replay/dial-search');
const { parseSports } = require('../../api/cron/dial-search');

describe('boardFor', () => {
  test('sport row over __all__ over the code default', () => {
    const b = ds.boardFor('NFL', [
      { sport: '__all__', dial: 'venue_weight', value: 0.25 },
      { sport: 'NFL', dial: 'venue_weight', value: 0.2 },
      { sport: 'MLB', dial: 'venue_weight', value: 0.9 },
    ]);
    expect(b.venue_weight).toBe(0.2);
    expect(b.sos_sensitivity).toBe(0.15);
  });
});

describe('searchVariants', () => {
  const board = ds.boardFor('NFL', [
    { sport: '__all__', dial: 'venue_weight', value: 0.25 },
    { sport: 'NFL', dial: 'form_weight', value: 0 },
  ]);
  const vs = ds.searchVariants('NFL', board);
  const byName = Object.fromEntries(vs.map(v => [v.name, v]));

  test('base first, then a 25 percent step down and up per dial', () => {
    expect(vs[0]).toEqual({ name: 'base', kind: 'current', dials: {} });
    expect(byName.venue_weight_dn.dials).toEqual({ venue_weight: 0.1875 });
    expect(byName.venue_weight_up.dials).toEqual({ venue_weight: 0.3125 });
  });
  test('a dial at zero tries the fixed step up and never goes negative', () => {
    expect(byName.form_weight_up.dials).toEqual({ form_weight: 0.05 });
    expect(byName.form_weight_dn).toBeUndefined();
  });
  test('the signed margin shift steps both ways from zero', () => {
    expect(byName.home_margin_shift_dn.dials).toEqual({ home_margin_shift: -0.25 });
    expect(byName.home_margin_shift_up.dials).toEqual({ home_margin_shift: 0.25 });
  });
  test('NFL searches injury_weight one 25 percent step each way (build_queue 118)', () => {
    expect(byName.injury_weight_dn.dials).toEqual({ injury_weight: 0.75 });
    expect(byName.injury_weight_up.dials).toEqual({ injury_weight: 1.25 });
  });
  test('injury_weight is NFL only', () => {
    for (const sport of ['MLB', 'NHL', 'NCAAF']) {
      const vs2 = ds.searchVariants(sport, ds.boardFor(sport, []));
      expect(vs2.some(v => v.name.startsWith('injury_weight'))).toBe(false);
    }
  });
  test('dials the replay cannot see are never searched', () => {
    const names = Object.keys(byName).join(' ');
    for (const d of ['injury_depth_unknown_weight', 'pitcher_anchor_damp', 'seed_weight', 'leg_prob_floor', 'min_gate_pp', 'publish_ml']) {
      expect(names).not.toContain(d);
    }
  });
  test('MLB skips the rest dials', () => {
    const mlb = ds.searchVariants('MLB', ds.boardFor('MLB', []));
    expect(mlb.some(v => v.name.startsWith('rest_'))).toBe(false);
  });
  test('names are safe for the variant parser', () => {
    for (const v of vs) expect(v.name).not.toMatch(/[:;,=]/);
  });
});

describe('stageOneWinners', () => {
  const variants = [
    { name: 'base', dials: {} },
    { name: 'venue_weight_dn', dials: { venue_weight: 0.18 } },
    { name: 'venue_weight_up', dials: { venue_weight: 0.31 } },
    { name: 'sos_sensitivity_up', dials: { sos_sensitivity: 0.19 } },
    { name: 'form_weight_up', dials: { form_weight: 0.05 } },
  ];
  const summary = { formulas: {
    base: { picks: 10, units: -2 },
    venue_weight_dn: { picks: 9, units: 1.5 },
    venue_weight_up: { picks: 9, units: 0 },
    sos_sensitivity_up: { picks: 10, units: -1.6 },
    form_weight_up: { picks: 0, units: 0 },
  } };
  test('beats base by the minimum, best first, one direction per dial', () => {
    const w = ds.stageOneWinners(summary, variants, { minDelta: 0.5, top: 4 });
    expect(w.map(x => x.name)).toEqual(['venue_weight_dn']);
    expect(w[0].delta).toBe(3.5);
  });
  test('a lower bar admits the smaller move, and top caps the list', () => {
    expect(ds.stageOneWinners(summary, variants, { minDelta: 0.3, top: 4 }).map(x => x.name)).toEqual(['venue_weight_dn', 'sos_sensitivity_up']);
    expect(ds.stageOneWinners(summary, variants, { minDelta: 0.3, top: 1 })).toHaveLength(1);
  });
  test('no base, no winners', () => {
    expect(ds.stageOneWinners({ formulas: {} }, variants)).toEqual([]);
  });
});

// A small fake of the supabase client: per table rows for selects, and a
// log of every write.
function fakeDb({ dials = [], moves = [] } = {}) {
  const writes = [];
  const rpc = jest.fn(async () => ({ data: { filed: 1, passed: [] }, error: null }));
  const from = (table) => {
    const rowsFor = () => (table === 'sport_dials' ? dials : table === 'dial_search_moves' ? moves : []);
    const filters = [];
    const q = {
      select: () => q,
      in: (col, vals) => { filters.push(r => vals.includes(r[col])); return q; },
      eq: (col, v) => { filters.push(r => r[col] === v); return q; },
      lte: (col, v) => { filters.push(r => r[col] <= v); return q; },
      then: (res, rej) => Promise.resolve({ data: rowsFor().filter(r => filters.every(f => f(r))), error: null }).then(res, rej),
      insert: async (row) => { writes.push(['insert', table, row]); return { error: null }; },
      upsert: async (row) => { writes.push(['upsert', table, row]); return { error: null }; },
      update: (row) => ({ eq: async (col, v) => { writes.push(['update', table, row, v]); return { error: null }; } }),
    };
    return q;
  };
  return { from, rpc, writes };
}

const searchWeek = async (_s, opts) => {
  const formulas = Object.fromEntries(opts.variants.map(v => [v.name, { picks: 5, won: 2, lost: 3, units: -1 }]));
  formulas.venue_weight_dn = { picks: 5, won: 4, lost: 1, units: 2 };
  return { formulas, picks_written: 10 };
};
const confirmWindow = async () => ({ formulas: { base: { picks: 40, won: 20, lost: 20, units: 1 }, venue_weight_dn: { picks: 38, won: 22, lost: 16, units: 5 } }, picks_written: 78 });

describe('runDialSearch', () => {
  beforeEach(() => { runReplay.mockReset(); });
  const board = [{ sport: '__all__', dial: 'venue_weight', value: 0.25 }];

  test('searches the recent week, confirms the winners on the weeks before, files the confirm run, writes no dial without apply', async () => {
    const db = fakeDb({ dials: board });
    runReplay.mockImplementationOnce(searchWeek).mockImplementationOnce(confirmWindow);
    const out = await ds.runDialSearch(db, { sport: 'NFL', recentDays: 7, confirmDays: 60, stamp: '20261012' });
    expect(runReplay.mock.calls[0][1]).toMatchObject({ sport: 'NFL', days: 7, runId: 'dial_search_nfl_20261012_recent' });
    expect(runReplay.mock.calls[1][1]).toMatchObject({ days: 60, offsetDays: 7, runId: 'dial_search_nfl_20261012_confirm' });
    expect(runReplay.mock.calls[1][1].variants.map(v => v.name)).toEqual(['base', 'venue_weight_dn']);
    expect(db.rpc).toHaveBeenCalledWith('file_replay_candidates', expect.objectContaining({ p_run_id: 'dial_search_nfl_20261012_confirm' }));
    expect(out.winners[0]).toMatchObject({ name: 'venue_weight_dn', delta: 3 });
    expect(db.writes).toEqual([]);
  });

  test('with apply, the best passing move lands on the board with its evidence and sunset', async () => {
    const db = fakeDb({ dials: board });
    db.rpc.mockResolvedValueOnce({ data: { filed: 1, passed: [{ name: 'venue_weight_dn', delta_units: 4, won: 22, lost: 16, units: 5 }] }, error: null });
    runReplay.mockImplementationOnce(searchWeek).mockImplementationOnce(confirmWindow);
    const out = await ds.runDialSearch(db, { sport: 'NFL', apply: true, stamp: 'x' });
    expect(out.applied).toMatchObject({ dial: 'venue_weight', before: 0.25, after: 0.1875 });
    const kinds = db.writes.map(w => `${w[0]} ${w[1]}`);
    expect(kinds).toEqual(['upsert sport_dials', 'insert model_weight_changes', 'insert dial_search_moves']);
    expect(db.writes[0][2]).toMatchObject({ sport: 'NFL', dial: 'venue_weight', value: 0.1875 });
    expect(db.writes[1][2]).toMatchObject({ source: 'dial-search-auto', before: { venue_weight: 0.25 }, after: { venue_weight: 0.1875 } });
    expect(db.writes[2][2].sunset_on).toBe(ds.addDays(out.applied.sunset_on, 0));
  });

  test('with the history gate, a move that lost over the prior seasons does not land', async () => {
    const db = fakeDb({ dials: board });
    db.rpc.mockResolvedValueOnce({ data: { filed: 1, passed: [{ name: 'venue_weight_dn', delta_units: 4, won: 22, lost: 16, units: 5 }] }, error: null });
    runReplay.mockImplementationOnce(searchWeek).mockImplementationOnce(confirmWindow);
    runHistoryReplay.mockResolvedValueOnce({ formulas: { base: { picks: 120, won: 62, lost: 58, units: 2 }, venue_weight_dn: { picks: 118, won: 57, lost: 61, units: -6 } }, games_with_results: 400, games_unmatched: 3 });
    const out = await ds.runDialSearch(db, { sport: 'NFL', apply: true, stamp: 'x' });
    expect(runHistoryReplay.mock.calls.at(-1)[1]).toMatchObject({ sport: 'NFL', runId: 'dial_search_nfl_x_history' });
    expect(out.history.verdicts.venue_weight_dn).toMatchObject({ checked: true, holds: false, delta_units: -8 });
    expect(out.applied).toBeNull();
    expect(db.writes).toEqual([]);
  });

  test('with the gate off, the history rides on the move as evidence', async () => {
    const db = fakeDb({ dials: board });
    db.rpc.mockResolvedValueOnce({ data: { filed: 1, passed: [{ name: 'venue_weight_dn', delta_units: 4, won: 22, lost: 16, units: 5 }] }, error: null });
    runReplay.mockImplementationOnce(searchWeek).mockImplementationOnce(confirmWindow);
    runHistoryReplay.mockResolvedValueOnce({ formulas: { base: { picks: 120, won: 62, lost: 58, units: 2 }, venue_weight_dn: { picks: 118, won: 57, lost: 61, units: -6 } }, games_with_results: 400, games_unmatched: 3 });
    const out = await ds.runDialSearch(db, { sport: 'NFL', apply: true, historyGate: false, stamp: 'x' });
    expect(out.applied).toMatchObject({ dial: 'venue_weight' });
    expect(db.writes[2][2].evidence.history).toMatchObject({ holds: false, units: -6 });
    expect(db.writes[1][2].reason).toMatch(/prior 3 seasons it went 57-61, -6u, -8u over base/);
  });

  test('with apply but nothing passed, no dial moves', async () => {
    const db = fakeDb({ dials: board });
    runReplay.mockImplementationOnce(searchWeek).mockImplementationOnce(confirmWindow);
    const out = await ds.runDialSearch(db, { sport: 'NFL', apply: true, stamp: 'x' });
    expect(out.applied).toBeNull();
    expect(db.writes).toEqual([]);
  });

  test('a dial with an open move is not searched', async () => {
    const db = fakeDb({ dials: board, moves: [{ id: 1, sport: 'NFL', dial: 'venue_weight', status: 'applied', sunset_on: '2099-01-01' }] });
    runReplay.mockImplementationOnce(async (_s, opts) => ({ formulas: Object.fromEntries(opts.variants.map(v => [v.name, { picks: 5, units: -1 }])), picks_written: 10 }));
    const out = await ds.runDialSearch(db, { sport: 'NFL', stamp: 'x' });
    expect(runReplay.mock.calls[0][1].variants.some(v => v.name.startsWith('venue_weight'))).toBe(false);
    expect(out.skipped_open_moves).toEqual(['venue_weight']);
  });

  test('a week where nothing beats base stops after the search', async () => {
    const db = fakeDb({ dials: board });
    runReplay.mockImplementationOnce(async (_s, opts) => ({ formulas: Object.fromEntries(opts.variants.map(v => [v.name, { picks: 5, units: -1 }])), picks_written: 10 }));
    const out = await ds.runDialSearch(db, { sport: 'NHL', stamp: 'x' });
    expect(runReplay).toHaveBeenCalledTimes(1);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(out.note).toMatch(/no dial beat base/);
  });
});

describe('resolveSunsets', () => {
  beforeEach(() => { runReplay.mockReset(); });
  const due = { id: 7, sport: 'NFL', dial: 'venue_weight', before_value: 0.25, after_value: 0.1875, status: 'applied', sunset_on: '2026-11-23', applied_at: '2026-10-12T06:30:00Z' };

  test('reverts when the old value did at least as well', async () => {
    const db = fakeDb({ moves: [due] });
    runReplay.mockResolvedValueOnce({ formulas: { base: { picks: 30, won: 14, lost: 16, units: -3 }, revert: { picks: 31, won: 16, lost: 15, units: 0.5 } } });
    const out = await ds.resolveSunsets(db, { sport: 'NFL', today: '2026-11-23', apply: true, tag: 't', log: () => {} });
    expect(runReplay.mock.calls[0][1]).toMatchObject({ days: 42, runId: 'dial_search_nfl_t_sunset_7' });
    expect(out[0].decision).toBe('revert');
    expect(db.writes[0]).toEqual(['upsert', 'sport_dials', expect.objectContaining({ dial: 'venue_weight', value: 0.25 })]);
    expect(db.writes[2]).toEqual(['update', 'dial_search_moves', expect.objectContaining({ status: 'reverted' }), 7]);
  });

  test('keeps when the move held up', async () => {
    const db = fakeDb({ moves: [due] });
    runReplay.mockResolvedValueOnce({ formulas: { base: { picks: 30, won: 18, lost: 12, units: 4 }, revert: { picks: 31, won: 16, lost: 15, units: 0.5 } } });
    const out = await ds.resolveSunsets(db, { sport: 'NFL', today: '2026-11-23', apply: true, tag: 't', log: () => {} });
    expect(out[0].decision).toBe('keep');
    expect(db.writes).toEqual([['update', 'dial_search_moves', expect.objectContaining({ status: 'kept' }), 7]]);
  });

  test('not due yet, nothing runs', async () => {
    const db = fakeDb({ moves: [due] });
    const out = await ds.resolveSunsets(db, { sport: 'NFL', today: '2026-11-01', apply: true, tag: 't', log: () => {} });
    expect(out).toEqual([]);
    expect(runReplay).not.toHaveBeenCalled();
  });
});

describe('bestPassedMove', () => {
  test('largest out of sample gain among this week winners', () => {
    const winners = [{ name: 'a_up', dials: { a: 1 }, delta: 1 }, { name: 'b_dn', dials: { b: 2 }, delta: 3 }];
    const m = ds.bestPassedMove({ passed: [{ name: 'b_dn', delta_units: 2 }, { name: 'a_up', delta_units: 5 }, { name: 'zz', delta_units: 9 }] }, winners);
    expect(m).toMatchObject({ name: 'a_up', dial: 'a', value: 1 });
    expect(ds.bestPassedMove({ passed: [] }, winners)).toBeNull();
    expect(ds.bestPassedMove(null, winners)).toBeNull();
  });
});

describe('parseSports', () => {
  test('known sports only, upper cased', () => {
    expect(parseSports('nfl, NHL,golf,MLB')).toEqual(['NFL', 'NHL', 'MLB']);
    expect(parseSports('')).toEqual([]);
  });
});
