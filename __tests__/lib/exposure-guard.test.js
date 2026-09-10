const { applyExposureGuard, shouldPenalize, _resetDialCache } = require('../../lib/services/exposure-guard');

// The chain ends at limit() for the record lookup; the dial lookup ends at
// eq(), which in this mock returns the builder (not a promise), so the
// guard falls through to its 2pp default exactly as it would on a dial
// read failure.
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

beforeEach(() => _resetDialCache());

describe('shouldPenalize', () => {
  test('two straight losses', () => {
    expect(shouldPenalize([{ actual_outcome: 'lost' }, { actual_outcome: 'lost' }])).toBe(true);
  });
  test('a cash anywhere in the last two clears it', () => {
    expect(shouldPenalize([{ actual_outcome: 'won' }, { actual_outcome: 'lost' }])).toBe(false);
    expect(shouldPenalize([{ actual_outcome: 'lost' }, { actual_outcome: 'won' }])).toBe(false);
  });
  test('needs a full streak', () => {
    expect(shouldPenalize([{ actual_outcome: 'lost' }])).toBe(false);
    expect(shouldPenalize([])).toBe(false);
    expect(shouldPenalize(null)).toBe(false);
  });
});

describe('applyExposureGuard', () => {
  test('deducts 2pp from the claim after back-to-back team losses', async () => {
    const supabase = mockSupabase({ data: [{ actual_outcome: 'lost' }, { actual_outcome: 'lost' }] });
    const r = await applyExposureGuard(supabase, { sport: 'MLB', team: 'Houston Astros', edgePp: 11.6 });
    expect(r.applied).toBe(true);
    expect(r.penaltyPp).toBe(2);
    expect(r.edgePp).toBeCloseTo(9.6, 10);
    expect(r.reason).toContain('Houston Astros');
    expect(r.reason).toContain('11.6 to 9.6');
    expect(supabase._capture.ilike[0]).toEqual(['pick', 'Houston Astros %']);
  });

  test('leaves the claim alone when the team just cashed', async () => {
    const supabase = mockSupabase({ data: [{ actual_outcome: 'won' }, { actual_outcome: 'lost' }] });
    const r = await applyExposureGuard(supabase, { sport: 'MLB', team: 'Houston Astros', edgePp: 11.6 });
    expect(r).toEqual({ edgePp: 11.6, penaltyPp: 0, applied: false, reason: null });
  });

  test('research labels under 4pp are never penalized, and skip the query', async () => {
    const supabase = mockSupabase({ data: [{ actual_outcome: 'lost' }, { actual_outcome: 'lost' }] });
    const r = await applyExposureGuard(supabase, { sport: 'MLB', team: 'Colorado Rockies', edgePp: 3.5 });
    expect(r).toEqual({ edgePp: 3.5, penaltyPp: 0, applied: false, reason: null });
    expect(supabase._capture.from).toBeUndefined();
  });

  test('fails soft on query error', async () => {
    const supabase = mockSupabase({ error: { message: 'down' } });
    const r = await applyExposureGuard(supabase, { sport: 'MLB', team: 'Houston Astros', edgePp: 8.0 });
    expect(r).toEqual({ edgePp: 8.0, penaltyPp: 0, applied: false, reason: null });
  });
});
