// The 2026-09-01 spread settlement incident: both JS outcome checkers
// SUBTRACTED the picked side's line instead of adding it, so favorites
// got an extra spread of slack (Red Sox -1.5 graded won on a 1-run win,
// Rays -1.5 graded won on an outright loss) and dogs were charged twice
// (a covering Braves +1.5 graded lost). The stored point is the picked
// side's OWN line, and covering means own margin plus line clears zero,
// exactly what the SQL grader determine_outcome always did. These pin
// the JS checkers to the SQL semantics.

const AISuggestionOutcomeChecker = require('../../lib/services/ai-suggestion-outcome-checker');
const ParlayOutcomeChecker = require('../../lib/services/parlay-outcome-checker');

describe('AISuggestionOutcomeChecker.checkSpreadOutcome', () => {
  const checker = new AISuggestionOutcomeChecker();
  const row = (pick, point) => ({ pick, point, home_team: 'Boston Red Sox', away_team: 'Seattle Mariners' });

  test('home favorite winning by less than the spread LOSES (Red Sox 9-8)', () => {
    expect(checker.checkSpreadOutcome(row('Boston Red Sox -1.5', '-1.50'), 1).result).toBe('lost');
  });

  test('home favorite losing outright LOSES (Rays 2-3)', () => {
    expect(checker.checkSpreadOutcome(row('Boston Red Sox -1.5', '-1.50'), -1).result).toBe('lost');
  });

  test('home favorite covering WINS', () => {
    expect(checker.checkSpreadOutcome(row('Boston Red Sox -1.5', '-1.50'), 2).result).toBe('won');
  });

  test('home dog losing by less than the spread WINS (Braves +1.5 class)', () => {
    expect(checker.checkSpreadOutcome(row('Boston Red Sox +1.5', '1.50'), -1).result).toBe('won');
  });

  test('home dog losing by more than the spread LOSES', () => {
    expect(checker.checkSpreadOutcome(row('Boston Red Sox +1.5', '1.50'), -2).result).toBe('lost');
  });

  test('away favorite needs its own cover (Yankees -1.5 on the road)', () => {
    expect(checker.checkSpreadOutcome(row('Seattle Mariners -1.5', '-1.50'), -1).result).toBe('lost');
    expect(checker.checkSpreadOutcome(row('Seattle Mariners -1.5', '-1.50'), -2).result).toBe('won');
  });

  test('exact landing is a push on whole-number lines', () => {
    expect(checker.checkSpreadOutcome(row('Boston Red Sox -2', '-2'), 2).result).toBe('push');
  });
});

describe('ParlayOutcomeChecker.checkSpreadOutcome', () => {
  const checker = new ParlayOutcomeChecker();
  const leg = (pick, point) => ({ pick, point, home_team: 'Boston Red Sox' });

  test('same semantics as the suggestion checker', () => {
    expect(checker.checkSpreadOutcome(leg('Boston Red Sox -1.5', '-1.50'), null, 1).result).toBe('lost');
    expect(checker.checkSpreadOutcome(leg('Boston Red Sox -1.5', '-1.50'), null, 2).result).toBe('won');
    expect(checker.checkSpreadOutcome(leg('Seattle Mariners +1.5', '1.50'), null, 1).result).toBe('won');
    expect(checker.checkSpreadOutcome(leg('Seattle Mariners +1.5', '1.50'), null, 2).result).toBe('lost');
  });
});
