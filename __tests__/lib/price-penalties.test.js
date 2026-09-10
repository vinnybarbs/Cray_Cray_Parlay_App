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
