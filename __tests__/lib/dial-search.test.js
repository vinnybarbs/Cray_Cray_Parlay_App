// The weekly dial search: the variant grid, the stage 1 winners, and the
// two stage run on a mocked replay.

jest.mock('../../lib/replay/replay-formula.js', () => ({ runReplay: jest.fn(), siteDate: (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Denver' }) }));
const { runReplay } = require('../../lib/replay/replay-formula.js');
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
  test('dials the replay cannot see are never searched', () => {
    const names = Object.keys(byName).join(' ');
    for (const d of ['injury_weight', 'pitcher_anchor_damp', 'seed_weight', 'leg_prob_floor', 'min_gate_pp', 'publish_ml']) {
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

describe('runDialSearch', () => {
  const rpc = jest.fn(async () => ({ data: { filed: 1 }, error: null }));
  const supabase = {
    from: () => ({ select: () => ({ in: async () => ({ data: [{ sport: '__all__', dial: 'venue_weight', value: 0.25 }], error: null }) }) }),
    rpc,
  };
  beforeEach(() => { runReplay.mockReset(); rpc.mockClear(); });

  test('searches the recent week, confirms the winners on the weeks before, files the confirm run', async () => {
    runReplay
      .mockImplementationOnce(async (_s, opts) => {
        const formulas = Object.fromEntries(opts.variants.map(v => [v.name, { picks: 5, won: 2, lost: 3, units: -1 }]));
        formulas.venue_weight_dn = { picks: 5, won: 4, lost: 1, units: 2 };
        return { formulas, picks_written: 10 };
      })
      .mockImplementationOnce(async () => ({ formulas: { base: { picks: 40, units: 1 }, venue_weight_dn: { picks: 38, units: 5 } }, picks_written: 78 }));
    const out = await ds.runDialSearch(supabase, { sport: 'NFL', recentDays: 7, confirmDays: 60, stamp: '20261012' });
    expect(runReplay.mock.calls[0][1]).toMatchObject({ sport: 'NFL', days: 7, runId: 'dial_search_nfl_20261012_recent' });
    expect(runReplay.mock.calls[1][1]).toMatchObject({ days: 60, offsetDays: 7, runId: 'dial_search_nfl_20261012_confirm' });
    expect(runReplay.mock.calls[1][1].variants.map(v => v.name)).toEqual(['base', 'venue_weight_dn']);
    expect(rpc).toHaveBeenCalledWith('file_replay_candidates', expect.objectContaining({ p_run_id: 'dial_search_nfl_20261012_confirm' }));
    expect(out.winners[0]).toMatchObject({ name: 'venue_weight_dn', delta: 3 });
    expect(out.candidates_filed).toEqual({ filed: 1 });
  });

  test('a week where nothing beats base stops after the search', async () => {
    runReplay.mockImplementationOnce(async (_s, opts) => ({ formulas: Object.fromEntries(opts.variants.map(v => [v.name, { picks: 5, units: -1 }])), picks_written: 10 }));
    const out = await ds.runDialSearch(supabase, { sport: 'NHL', stamp: 'x' });
    expect(runReplay).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
    expect(out.note).toMatch(/no dial beat base/);
  });
});

describe('parseSports', () => {
  test('known sports only, upper cased', () => {
    expect(parseSports('nfl, NHL,golf,MLB')).toEqual(['NFL', 'NHL', 'MLB']);
    expect(parseSports('')).toEqual([]);
  });
});
