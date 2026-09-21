process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const { EdgeCalculator } = require('../../lib/services/edge-calculator');

function fakeSupabase(rows) {
  return { from: () => ({ select: async () => ({ data: rows, error: null }) }) };
}

// Owner 2026-09-21: legs are reserved for near sure things. The floor is
// a dial per sport, __all__ then the code default.
describe('leg_prob_floor dial', () => {
  const board = [
    { sport: '__all__', dial: 'leg_prob_floor', value: '0.75' },
    { sport: 'NFL', dial: 'leg_prob_floor', value: '0.80' },
    { sport: 'MLB', dial: 'leg_prob_floor', value: '0.70' },
  ];

  test('sport row wins, then the pooled row', async () => {
    const calc = new EdgeCalculator(fakeSupabase(board));
    expect(await calc.dialValue('NFL', 'leg_prob_floor')).toBe(0.8);
    expect(await calc.dialValue('MLB', 'leg_prob_floor')).toBe(0.7);
    expect(await calc.dialValue('Tennis', 'leg_prob_floor')).toBe(0.75);
    expect(await calc.dialValue('UFC', 'leg_prob_floor')).toBe(0.75);
  });

  test('an empty board falls back to the shipped 0.65, never an empty pool', async () => {
    const calc = new EdgeCalculator(fakeSupabase([]));
    expect(await calc.dialValue('NFL', 'leg_prob_floor')).toBe(0.65);
  });

  test('a board outage serves the code default', async () => {
    const calc = new EdgeCalculator({ from: () => ({ select: async () => ({ data: null, error: new Error('down') }) }) });
    expect(await calc.dialValue('MLB', 'leg_prob_floor')).toBe(0.65);
  });

  test('the Packers at 65.1 percent are no longer a leg, the 49ers at 87.6 still are', async () => {
    const calc = new EdgeCalculator(fakeSupabase(board));
    const floor = await calc.dialValue('NFL', 'leg_prob_floor');
    expect(0.651 >= floor).toBe(false);
    expect(0.876 >= floor).toBe(true);
  });
});
