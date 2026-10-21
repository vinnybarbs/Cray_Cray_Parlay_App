const { summarizeBoard } = require('../../api/board-history');

// Build_queue 117: the owner voided 18401 and 18402 (postponed) and the
// board showed them as pushes.
describe('summarizeBoard', () => {
  test('counts a void apart from a push and stakes neither', () => {
    const s = summarizeBoard([
      { actual_outcome: 'won', odds: '+120' },
      { actual_outcome: 'lost', odds: '-110' },
      { actual_outcome: 'push', odds: '-110' },
      { actual_outcome: 'void', odds: '-198' },
      { actual_outcome: 'void', odds: '-110' },
      { actual_outcome: null, odds: '-110' },
    ]);
    expect(s).toMatchObject({ total: 6, won: 1, lost: 1, push: 1, void: 2, pending: 1, units: 0.2, winRate: 50 });
  });
});
