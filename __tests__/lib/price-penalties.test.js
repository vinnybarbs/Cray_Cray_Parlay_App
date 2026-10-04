// The price rails as pp deductions (owner, 2026-09-10): the -150 chalk
// fence and the +300 longshot ceiling no longer swap labels, they deduct
// from the claim and the tier falls out of the adjusted pp. Backend and
// frontend mirrors must agree to the tenth.

const { pricePenaltyPp, applyPricePenalties, _resetDialCache } = require('../../lib/services/price-penalties');
const { edgeTier } = require('../../lib/services/pick-grader');

beforeEach(() => _resetDialCache());

describe('pricePenaltyPp', () => {
  test('chalk at -150 or heavier deducts a flat 3pp', () => {
    const r = pricePenaltyPp(12, '-160');
    expect(r).toMatchObject({ edgePp: 9, penaltyPp: 3, kind: 'chalk', applied: true });
    expect(r.reason).toContain('Chalk price');
    expect(r.reason).toContain('12 to 9');
    expect(pricePenaltyPp(12, '-150').edgePp).toBe(9);
  });

  test('chalk lighter than -150 and any plus price under +300 is untouched', () => {
    expect(pricePenaltyPp(12, '-149')).toMatchObject({ edgePp: 12, applied: false, kind: null });
    expect(pricePenaltyPp(12, '-120').applied).toBe(false);
    expect(pricePenaltyPp(8, '+120').applied).toBe(false);
    expect(pricePenaltyPp(15, '+295').applied).toBe(false);
  });

  test('a longshot deducts 6pp at +300, scaling with price', () => {
    expect(pricePenaltyPp(9, '+300')).toMatchObject({ edgePp: 3, penaltyPp: 6, kind: 'longshot', applied: true });
    expect(pricePenaltyPp(15, '+450')).toMatchObject({ edgePp: 6, penaltyPp: 9 });
    expect(pricePenaltyPp(15, '+1300')).toMatchObject({ edgePp: 2, penaltyPp: 26 });
    expect(pricePenaltyPp(15, '+1300').reason).toContain('Longshot price');
  });

  test('a penalty floors at the 2pp Lean gate, it never manufactures a fade', () => {
    expect(pricePenaltyPp(2.5, '-200').edgePp).toBe(2);
    expect(pricePenaltyPp(4, '+1300').edgePp).toBe(2);
    expect(edgeTier(pricePenaltyPp(4, '+1300').edgePp)).toBe('Lean');
  });

  test('a railed claim already at the floor keeps its marker with a zero deduction', () => {
    const r = pricePenaltyPp(2.0, '-410');
    expect(r).toMatchObject({ edgePp: 2.0, penaltyPp: 0, kind: 'chalk', applied: true });
    expect(r.reason).toContain('Chalk price');
    expect(r.reason).toContain('no deduction');
  });

  test('skips and traps are not priced, they are not picks', () => {
    expect(pricePenaltyPp(1, '+1300').applied).toBe(false);
    expect(pricePenaltyPp(-5, '-200').applied).toBe(false);
    expect(pricePenaltyPp(-5, '-200').edgePp).toBe(-5);
  });

  test('no known price means no penalty, the pp bands decide', () => {
    expect(pricePenaltyPp(12, null).applied).toBe(false);
    expect(pricePenaltyPp(12, 'EVEN').applied).toBe(false);
  });

  test('dials override the defaults, and zero disables a rail', () => {
    expect(pricePenaltyPp(12, '-200', { chalkPp: 5 }).edgePp).toBe(7);
    expect(pricePenaltyPp(12, '-200', { chalkPp: 0 }).applied).toBe(false);
    expect(pricePenaltyPp(12, '+600', { longshotPp: 2 }).edgePp).toBe(8);
  });

  test('a monster chalk claim can still be a Sharp Take, the fence used to hide it', () => {
    expect(edgeTier(pricePenaltyPp(14, '-180').edgePp)).toBe('Sharp Take');
    expect(edgeTier(pricePenaltyPp(12, '-180').edgePp)).toBe('Strong Play');
    expect(edgeTier(pricePenaltyPp(12, '-120').edgePp)).toBe('Sharp Take');
  });
});

describe('edgeTier is a pure pp band', () => {
  test('price no longer moves the label', () => {
    expect(edgeTier(15, '+1300')).toBe('Sharp Take');
    expect(edgeTier(12, '-160')).toBe('Sharp Take');
  });
  test('bands', () => {
    expect(edgeTier(-2)).toBe('Trap');
    expect(edgeTier(1.9)).toBe('Skip');
    expect(edgeTier(2)).toBe('Lean');
    expect(edgeTier(4)).toBe('Play');
    expect(edgeTier(7)).toBe('Strong Play');
    expect(edgeTier(10)).toBe('Sharp Take');
    expect(edgeTier(null)).toBe(null);
  });
});

describe('applyPricePenalties reads the dial board', () => {
  function mockSupabase(rows) {
    const builder = {};
    builder.select = () => builder;
    builder.in = () => Promise.resolve({ data: rows, error: null });
    return { from: () => builder };
  }

  test('sport row over __all__ over default', async () => {
    const supabase = mockSupabase([
      { sport: '__all__', dial: 'chalk_penalty_pp', value: 3 },
      { sport: 'NHL', dial: 'chalk_penalty_pp', value: 1 },
      { sport: '__all__', dial: 'longshot_penalty_pp', value: 6 },
    ]);
    expect((await applyPricePenalties(supabase, { sport: 'NHL', edgePp: 12, odds: '-200' })).edgePp).toBe(11);
    expect((await applyPricePenalties(supabase, { sport: 'MLB', edgePp: 12, odds: '-200' })).edgePp).toBe(9);
    expect((await applyPricePenalties(supabase, { sport: 'MLB', edgePp: 12, odds: '+600' })).edgePp).toBe(2);
  });

  test('a dial read failure serves the code defaults', async () => {
    const supabase = { from: () => { throw new Error('down'); } };
    expect((await applyPricePenalties(supabase, { sport: 'MLB', edgePp: 12, odds: '-200' })).edgePp).toBe(9);
  });
});

// Owner 2026-10-03: "for post season if there isn't probable then we
// should just cut pp and still publish." The no starter rail deducts
// no_starter_penalty_pp from an MLB read that has no Probable starters
// factor and never holds it.
describe('noStarterPenaltyPp (2026-10-03)', () => {
  const { noStarterPenaltyPp, hasStarterFactor, applyNoStarterPenalty, DEFAULT_NO_STARTER_PENALTY_PP } = require('../../lib/services/price-penalties');
  const withStarters = { adjustments: [{ factor: 'Probable starters', impact: 0.02 }] };
  const without = { adjustments: [{ factor: 'Home higher playoff seed', impact: 0.015 }] };

  test('reads the factor off the edge result', () => {
    expect(hasStarterFactor(withStarters)).toBe(true);
    expect(hasStarterFactor(without)).toBe(false);
    expect(hasStarterFactor(null)).toBe(false);
  });

  test('deducts the rail without the factor, floors at the Lean gate, leaves a read with the factor alone', () => {
    const r = noStarterPenaltyPp(7.4, false, { pp: 3 });
    expect(r).toMatchObject({ edgePp: 4.4, penaltyPp: 3, kind: 'no_starter', applied: true });
    expect(r.reason).toContain('No starters');
    expect(r.reason).toContain('7.4 to 4.4');
    expect(noStarterPenaltyPp(3.5, false, { pp: 3 })).toMatchObject({ edgePp: 2, penaltyPp: 3, applied: true });
    const floor = noStarterPenaltyPp(2, false, { pp: 3 });
    expect(floor).toMatchObject({ edgePp: 2, penaltyPp: 0, applied: true });
    expect(floor.reason).toContain('Lean floor');
    expect(noStarterPenaltyPp(7.4, true, { pp: 3 })).toMatchObject({ edgePp: 7.4, applied: false, kind: null });
    expect(noStarterPenaltyPp(7.4, false, { pp: 0 })).toMatchObject({ applied: false });
    expect(noStarterPenaltyPp(1.5, false, { pp: 3 })).toMatchObject({ applied: false });
  });

  test('the dial board sizes it per sport, MLB 3 by default and every other sport 0', async () => {
    expect(DEFAULT_NO_STARTER_PENALTY_PP).toEqual({ MLB: 3 });
    const board = (rows) => ({ from: () => ({ select: () => ({ in: async () => ({ data: rows }) }) }) });
    _resetDialCache();
    expect(await applyNoStarterPenalty(board([]), { sport: 'MLB', edgePp: 6, edgeData: without })).toMatchObject({ edgePp: 3, applied: true });
    expect(await applyNoStarterPenalty(board([]), { sport: 'NFL', edgePp: 6, edgeData: without })).toMatchObject({ applied: false });
    _resetDialCache();
    expect(await applyNoStarterPenalty(board([{ sport: 'MLB', dial: 'no_starter_penalty_pp', value: 1.5 }]), { sport: 'MLB', edgePp: 6, edgeData: without })).toMatchObject({ edgePp: 4.5, penaltyPp: 1.5 });
    expect(await applyNoStarterPenalty(board([]), { sport: 'MLB', edgePp: 6, edgeData: withStarters })).toMatchObject({ applied: false });
  });
});

// NHL (2026-10-03): the same rail keyed on the Starting goalies row and
// the no_goalie_penalty_pp dial, seeded 0 so nothing comes off until the
// shadow gate has evidence.
describe('the starter rail per sport (NHL goalies)', () => {
  const { hasStarterFactor, applyNoStarterPenalty, STARTER_FACTOR_BY_SPORT, STARTER_DIAL_BY_SPORT } = require('../../lib/services/price-penalties');
  const goalies = { adjustments: [{ factor: 'Starting goalies', impact: 0.01 }] };
  const none = { adjustments: [] };
  const board = (rows) => ({ from: () => ({ select: () => ({ in: async () => ({ data: rows }) }) }) });

  test('the factor and the dial are keyed per sport', () => {
    expect(STARTER_FACTOR_BY_SPORT).toEqual({ MLB: 'Probable starters', NHL: 'Starting goalies' });
    expect(STARTER_DIAL_BY_SPORT.NHL).toBe('no_goalie_penalty_pp');
    expect(hasStarterFactor(goalies, 'NHL')).toBe(true);
    expect(hasStarterFactor(goalies, 'MLB')).toBe(false);
  });

  test('NHL deducts nothing at the seed, deducts the dial once set, other sports never', async () => {
    _resetDialCache();
    expect(await applyNoStarterPenalty(board([]), { sport: 'NHL', edgePp: 6, edgeData: none })).toMatchObject({ applied: false });
    _resetDialCache();
    const r = await applyNoStarterPenalty(board([{ sport: 'NHL', dial: 'no_goalie_penalty_pp', value: 2 }]), { sport: 'NHL', edgePp: 6, edgeData: none });
    expect(r).toMatchObject({ edgePp: 4, penaltyPp: 2, applied: true });
    expect(r.reason).toContain('No goalie');
    expect(await applyNoStarterPenalty(board([]), { sport: 'NHL', edgePp: 6, edgeData: goalies })).toMatchObject({ applied: false });
    expect(await applyNoStarterPenalty(board([]), { sport: 'NFL', edgePp: 6, edgeData: none })).toMatchObject({ applied: false });
  });
});
