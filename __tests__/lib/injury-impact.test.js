const { EdgeCalculator } = require('../../lib/services/edge-calculator');

// Stub supabase whose news_cache injuries query returns the given summaries.
function stubSupabase(summaries) {
  const result = { data: summaries.map((s) => ({ summary: s })) };
  const chain = {
    select: () => chain,
    eq: () => chain,
    ilike: () => chain,
    gt: () => chain,
    limit: () => Promise.resolve(result),
  };
  return { from: () => chain };
}

const WORDY = 'Star player out for the season. Second starter out with a hamstring. Third doubtful, fourth questionable.';

describe('getInjuryImpact', () => {
  test('MLB is always zero, whatever the injury text says', async () => {
    const calc = new EdgeCalculator(stubSupabase([WORDY, WORDY]));
    expect(await calc.getInjuryImpact('Los Angeles Dodgers', 'MLB')).toBe(0);
  });

  test('other sports cap at -0.03 even with maximal wording', async () => {
    const calc = new EdgeCalculator(stubSupabase([WORDY, WORDY]));
    const impact = await calc.getInjuryImpact('Denver Nuggets', 'NBA');
    expect(impact).toBeLessThan(0);
    expect(impact).toBeGreaterThanOrEqual(-0.03);
  });

  test('light wording lands under the cap', async () => {
    const calc = new EdgeCalculator(stubSupabase(['One rotation player questionable for tonight.']));
    const impact = await calc.getInjuryImpact('Denver Nuggets', 'NBA');
    expect(impact).toBeCloseTo(-0.005, 5);
  });

  test('no injury rows means zero', async () => {
    const calc = new EdgeCalculator(stubSupabase([]));
    expect(await calc.getInjuryImpact('Denver Nuggets', 'NBA')).toBe(0);
  });

  test('fails soft to zero on a query error', async () => {
    const broken = { from: () => { throw new Error('boom'); } };
    const calc = new EdgeCalculator(broken);
    expect(await calc.getInjuryImpact('Denver Nuggets', 'NBA')).toBe(0);
  });
});
