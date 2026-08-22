const { applyExposureGuard, shouldDemote, demoteTier } = require('../../lib/services/exposure-guard');

function mockSupabase({ data = null, error = null, capture = {} } = {}) {
  const builder = {};
  const record = (name) => (...args) => {
    (capture[name] = capture[name] || []).push(args);
    return builder;
  };
  for (const m of ['select', 'eq', 'in', 'is', 'gte', 'order']) builder[m] = record(m);
  builder.ilike = record('ilike');
  builder.limit = (...args) => {
    (capture.limit = capture.limit || []).push(args);
    return Promise.resolve({ data, error });
  };
  return { from: record('from'), _capture: capture };
}

describe('demoteTier', () => {
  test('steps one rung down the ladder', () => {
    expect(demoteTier('Sharp Take')).toBe('Strong Play');
    expect(demoteTier('Strong Play')).toBe('Play');
    expect(demoteTier('Play')).toBe('Lean');
  });

  test('tiers off the ladder pass through', () => {
    expect(demoteTier('Lean')).toBe('Lean');
    expect(demoteTier('Trap')).toBe('Trap');
  });
});

describe('shouldDemote', () => {
  test('two most recent losses trigger', () => {
    expect(shouldDemote([{ actual_outcome: 'lost' }, { actual_outcome: 'lost' }])).toBe(true);
  });

  test('a cash in the last two clears the streak', () => {
    expect(shouldDemote([{ actual_outcome: 'won' }, { actual_outcome: 'lost' }])).toBe(false);
    expect(shouldDemote([{ actual_outcome: 'lost' }, { actual_outcome: 'won' }])).toBe(false);
  });

  test('thin history never demotes', () => {
    expect(shouldDemote([{ actual_outcome: 'lost' }])).toBe(false);
    expect(shouldDemote([])).toBe(false);
    expect(shouldDemote(null)).toBe(false);
  });
});

describe('applyExposureGuard', () => {
  test('demotes a Sharp Take after back-to-back team losses', async () => {
    const supabase = mockSupabase({ data: [{ actual_outcome: 'lost' }, { actual_outcome: 'lost' }] });
    const r = await applyExposureGuard(supabase, { sport: 'MLB', team: 'Houston Astros', tier: 'Sharp Take' });
    expect(r.demoted).toBe(true);
    expect(r.tier).toBe('Strong Play');
    expect(r.reason).toContain('Houston Astros');
    expect(supabase._capture.ilike[0]).toEqual(['pick', 'Houston Astros %']);
  });

  test('leaves the tier alone when the team just cashed', async () => {
    const supabase = mockSupabase({ data: [{ actual_outcome: 'won' }, { actual_outcome: 'lost' }] });
    const r = await applyExposureGuard(supabase, { sport: 'MLB', team: 'Houston Astros', tier: 'Sharp Take' });
    expect(r).toEqual({ tier: 'Sharp Take', demoted: false, reason: null });
  });

  test('only bet tiers are demotable, and lower tiers skip the query', async () => {
    const supabase = mockSupabase({ data: [{ actual_outcome: 'lost' }, { actual_outcome: 'lost' }] });
    const r = await applyExposureGuard(supabase, { sport: 'MLB', team: 'Colorado Rockies', tier: 'Play' });
    expect(r).toEqual({ tier: 'Play', demoted: false, reason: null });
    expect(supabase._capture.from).toBeUndefined();
  });

  test('fails soft on query error', async () => {
    const supabase = mockSupabase({ error: { message: 'down' } });
    const r = await applyExposureGuard(supabase, { sport: 'MLB', team: 'Houston Astros', tier: 'Strong Play' });
    expect(r).toEqual({ tier: 'Strong Play', demoted: false, reason: null });
  });
});
