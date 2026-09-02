// The longshot tier ceiling (owner rule 2026-09-02): a side priced +300
// or longer is never labeled above Lean, whatever the claimed edge. "No
// name college teams playing SEC power houses at +1300 is not a strong
// pick period." Rails the dog end of the price axis the way the -150
// chalk fence rails the favorite end.

const { edgeTier } = require('../../lib/services/pick-grader');

describe('longshot tier ceiling', () => {
  test('a +1300 longshot caps at Lean no matter the claimed edge', () => {
    expect(edgeTier(15, '+1300')).toBe('Lean');
    expect(edgeTier(8, '+300')).toBe('Lean');
    expect(edgeTier(4.5, '+450')).toBe('Lean');
  });

  test('prices inside the rail are untouched', () => {
    expect(edgeTier(15, '+295')).toBe('Sharp Take');
    expect(edgeTier(8, '+120')).toBe('Strong Play');
    expect(edgeTier(5, '-110')).toBe('Play');
  });

  test('the chalk fence still holds on the other end', () => {
    expect(edgeTier(12, '-160')).toBe('Strong Play');
    expect(edgeTier(12, '-120')).toBe('Sharp Take');
  });

  test('traps and skips are not price-capped, they are not picks', () => {
    expect(edgeTier(-5, '+1300')).toBe('Trap');
    expect(edgeTier(1, '+1300')).toBe('Skip');
  });

  test('no known price means no ceiling, the pp bands decide', () => {
    expect(edgeTier(12, null)).toBe('Sharp Take');
  });
});
