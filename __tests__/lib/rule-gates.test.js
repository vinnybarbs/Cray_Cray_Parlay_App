// The four MLB shadow gates the owner approved 2026-10-01 ("They log
// only"). The evaluator is pure, the logger fails soft, and nothing here
// can change a publish while a rule is in shadow mode.

const { DEFAULT_RULES, pickContext, evaluateRuleGates, runRuleGates, startersFor, _resetRuleCache } = require('../../lib/services/rule-gates');

beforeEach(() => _resetRuleCache());

const starters = { factor: 'Probable starters', impact: 0.03, detail: 'Logan Webb (3.10 ERA) at Zac Gallen (4.55 ERA)', homeEra: 4.55, awayEra: 3.10 };
const edgeWith = (extra = {}) => ({
  edgesRaw: { home_ml: 0.021, away_ml: 0.064, home_spread: -0.01, away_spread: 0.03 },
  coverProbs: { home_spread: 0.32, away_spread: 0.68 },
  adjustments: [starters],
  ...extra,
});
const verdicts = (rs) => Object.fromEntries(rs.map(r => [r.rule_key, r.verdict]));

describe('pickContext', () => {
  test('reads market, role, price, claim, cover probability and the pick side starter gap', () => {
    const ctx = pickContext({ sport: 'MLB', side: 'away_ml', point: null, odds: '-135', edgeData: edgeWith() });
    expect(ctx).toMatchObject({ market: 'ml', role: 'favorite', price: -135, ml_claim_pp: 6.4 });
    expect(ctx.starters).toEqual({ present: true, pickEra: 3.10, oppEra: 4.55, gap: 1.45 });
    const dog = pickContext({ sport: 'MLB', side: 'home_spread', point: 1.5, odds: '-150', edgeData: edgeWith() });
    expect(dog).toMatchObject({ market: 'spread', role: 'underdog', cover_prob: 0.32, ml_claim_pp: 2.1 });
  });

  test('totals and unknown sides have no context, and the gap falls back to the detail text', () => {
    expect(pickContext({ sport: 'MLB', side: 'over', odds: '-110', edgeData: edgeWith() })).toBeNull();
    const legacy = { ...starters }; delete legacy.homeEra; delete legacy.awayEra;
    expect(startersFor({ adjustments: [legacy] }, 'home_ml')).toEqual({ present: true, pickEra: 4.55, oppEra: 3.10, gap: -1.45 });
    expect(startersFor({ adjustments: [] }, 'home_ml').present).toBe(false);
  });
});

describe('evaluateRuleGates on the seeded MLB rules', () => {
  test('a favorite with starters, a 1.45 gap and a -135 price passes every moneyline rule', () => {
    const ctx = pickContext({ sport: 'MLB', side: 'away_ml', odds: '-135', edgeData: edgeWith() });
    expect(verdicts(evaluateRuleGates(DEFAULT_RULES, ctx))).toEqual({ starter_required: 'pass', starter_gap_025: 'pass', light_favorite_rail: 'pass' });
  });

  test('starter required holds without the factor, and the gap rule stays out of it', () => {
    const ctx = pickContext({ sport: 'MLB', side: 'away_ml', odds: '-135', edgeData: edgeWith({ adjustments: [] }) });
    expect(verdicts(evaluateRuleGates(DEFAULT_RULES, ctx))).toEqual({ starter_required: 'hold', light_favorite_rail: 'pass' });
  });

  test('the gap rule holds a favorite whose starter is not 0.25 better, and skips underdogs', () => {
    const thin = edgeWith({ adjustments: [{ ...starters, homeEra: 3.20, awayEra: 3.10 }] });
    const fav = pickContext({ sport: 'MLB', side: 'away_ml', odds: '-135', edgeData: thin });
    expect(verdicts(evaluateRuleGates(DEFAULT_RULES, fav)).starter_gap_025).toBe('hold');
    const dog = pickContext({ sport: 'MLB', side: 'home_ml', odds: '+125', edgeData: thin });
    expect(verdicts(evaluateRuleGates(DEFAULT_RULES, dog))).toEqual({ starter_required: 'pass', light_favorite_rail: 'pass' });
  });

  test('the light favorite rail holds -115 to +110 and passes either side of it', () => {
    for (const [odds, v] of [['-115', 'hold'], ['-105', 'hold'], ['+100', 'hold'], ['+110', 'hold'], ['-116', 'pass'], ['+111', 'pass']]) {
      const ctx = pickContext({ sport: 'MLB', side: 'home_ml', odds, edgeData: edgeWith() });
      expect(verdicts(evaluateRuleGates(DEFAULT_RULES, ctx)).light_favorite_rail).toBe(v);
    }
  });

  test('the run line favorite rule needs starters and a moneyline claim under 5pp', () => {
    const ok = pickContext({ sport: 'MLB', side: 'home_spread', point: -1.5, odds: '+140', edgeData: edgeWith() });
    expect(verdicts(evaluateRuleGates(DEFAULT_RULES, ok))).toEqual({ starter_required: 'pass', rl_favorite_rule: 'pass' });
    const big = pickContext({ sport: 'MLB', side: 'away_spread', point: -1.5, odds: '+140', edgeData: edgeWith() });
    expect(verdicts(evaluateRuleGates(DEFAULT_RULES, big)).rl_favorite_rule).toBe('hold');
    const none = pickContext({ sport: 'MLB', side: 'home_spread', point: -1.5, odds: '+140', edgeData: edgeWith({ adjustments: [] }) });
    expect(verdicts(evaluateRuleGates(DEFAULT_RULES, none))).toEqual({ starter_required: 'hold', rl_favorite_rule: 'hold' });
  });

  test('the +1.5 dog floor reads the model cover probability at 0.65', () => {
    const strong = pickContext({ sport: 'MLB', side: 'away_spread', point: 1.5, odds: '-160', edgeData: edgeWith() });
    expect(verdicts(evaluateRuleGates(DEFAULT_RULES, strong))).toEqual({ starter_required: 'pass', rl_dog_prob_floor: 'pass' });
    const weak = pickContext({ sport: 'MLB', side: 'home_spread', point: 1.5, odds: '-160', edgeData: edgeWith() });
    expect(verdicts(evaluateRuleGates(DEFAULT_RULES, weak)).rl_dog_prob_floor).toBe('hold');
    const blind = pickContext({ sport: 'MLB', side: 'home_spread', point: 1.5, odds: '-160', edgeData: edgeWith({ coverProbs: {} }) });
    expect(verdicts(evaluateRuleGates(DEFAULT_RULES, blind)).rl_dog_prob_floor).toBe('hold');
  });

  test('rules never pool across sports, off rules are ignored, inputs ride along', () => {
    const nfl = pickContext({ sport: 'NFL', side: 'home_ml', odds: '-105', edgeData: edgeWith() });
    expect(evaluateRuleGates(DEFAULT_RULES, nfl)).toEqual([]);
    const off = DEFAULT_RULES.map(r => ({ ...r, mode: 'off' }));
    const mlb = pickContext({ sport: 'MLB', side: 'home_ml', odds: '-105', edgeData: edgeWith() });
    expect(evaluateRuleGates(off, mlb)).toEqual([]);
    const [first] = evaluateRuleGates(DEFAULT_RULES, mlb);
    expect(first.inputs).toMatchObject({ price: -105, market: 'ml', starters: { gap: -1.45 }, params: expect.any(Object) });
    expect(evaluateRuleGates(DEFAULT_RULES, null)).toEqual([]);
  });
});

describe('runRuleGates', () => {
  function fakeSupabase({ rules = null, upsertError = null, fail = false } = {}) {
    const calls = { upserts: [] };
    const client = {
      from(table) {
        if (table === 'rule_gates') {
          const chain = { select: () => chain, neq: () => chain, then(resolve) { if (fail) throw new Error('down'); resolve({ data: rules, error: null }); } };
          return chain;
        }
        if (table === 'rule_gate_log') {
          return { upsert: async (rows, opts) => { calls.upserts.push({ rows, opts }); return { error: upsertError }; } };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    return { client, calls };
  }
  const game = { game_key: 'mlb_sf_az_2026-10-01', home_team: 'Arizona Diamondbacks', away_team: 'San Francisco Giants', game_date: '2026-10-01T23:40:00Z' };

  test('logs one row per applicable rule keyed by session, game and rule, and reports holds', async () => {
    const { client, calls } = fakeSupabase({ rules: DEFAULT_RULES });
    const log = jest.fn();
    const out = await runRuleGates(client, {
      sport: 'MLB', game, sessionId: 'auto_digest_2026-10-01', pick: 'San Francisco Giants ML -105', betType: 'Moneyline', side: 'away_ml',
      point: null, odds: '-105', edgeData: edgeWith(), tier: 'Play', edgePp: 4.2, log,
    });
    expect(verdicts(out)).toEqual({ starter_required: 'pass', starter_gap_025: 'pass', light_favorite_rail: 'hold' });
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0].opts).toEqual({ onConflict: 'session_id,game_key,rule_key' });
    expect(calls.upserts[0].rows.map(r => r.rule_key)).toEqual(['starter_required', 'starter_gap_025', 'light_favorite_rail']);
    expect(calls.upserts[0].rows[2]).toMatchObject({ session_id: 'auto_digest_2026-10-01', game_key: game.game_key, verdict: 'hold', mode: 'shadow', tier: 'Play', edge_pp: 4.2, pick: 'San Francisco Giants ML -105' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Shadow gate hold'));
  });

  test('a sport with no rules writes nothing, and a table outage falls back to the seeds and never throws', async () => {
    const { client, calls } = fakeSupabase({ rules: DEFAULT_RULES });
    expect(await runRuleGates(client, { sport: 'NFL', game, sessionId: 's', pick: 'x', betType: 'Moneyline', side: 'home_ml', odds: '-105', edgeData: edgeWith() })).toEqual([]);
    expect(calls.upserts).toHaveLength(0);
    _resetRuleCache();
    const down = fakeSupabase({ fail: true, upsertError: { message: 'nope' } });
    const out = await runRuleGates(down.client, { sport: 'MLB', game, sessionId: 's', pick: 'x', betType: 'Moneyline', side: 'home_ml', odds: '-105', edgeData: edgeWith(), log: () => {} });
    expect(out.length).toBe(3);
    expect(down.calls.upserts).toHaveLength(1);
  });
});

describe('goalie_required (NHL, 2026-10-03)', () => {
  const goalies = { factor: 'Starting goalies', impact: 0, detail: 'A (.905, Likely) at B (.912, Confirmed)', homeStatus: 'Confirmed', awayStatus: 'Likely' };
  const edge = (adjs) => ({ edgesRaw: { home_ml: 0.03, away_ml: -0.03, home_spread: 0.01, away_spread: -0.01 }, coverProbs: { home_spread: 0.6, away_spread: 0.4 }, adjustments: adjs });

  test('passes with both goalies named, holds without, never on totals, never for MLB', () => {
    const ok = pickContext({ sport: 'NHL', side: 'home_ml', odds: '-130', edgeData: edge([goalies]) });
    expect(verdicts(evaluateRuleGates(DEFAULT_RULES, ok))).toEqual({ goalie_required: 'pass' });
    expect(evaluateRuleGates(DEFAULT_RULES, ok)[0].inputs.goalies).toEqual({ home_status: 'Confirmed', away_status: 'Likely' });
    const bare = pickContext({ sport: 'NHL', side: 'away_spread', point: 1.5, odds: '-180', edgeData: edge([]) });
    expect(verdicts(evaluateRuleGates(DEFAULT_RULES, bare))).toEqual({ goalie_required: 'hold' });
    expect(pickContext({ sport: 'NHL', side: 'over', odds: '-110', edgeData: edge([]) })).toBeNull();
    const mlb = pickContext({ sport: 'MLB', side: 'home_ml', odds: '-130', edgeData: edge([goalies]) });
    expect(verdicts(evaluateRuleGates(DEFAULT_RULES, mlb)).goalie_required).toBeUndefined();
  });
});
