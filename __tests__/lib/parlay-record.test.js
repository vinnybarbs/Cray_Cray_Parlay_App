const { houseParlayRecord, tally, CURRENT_RULE } = require('../../lib/services/parlay-record.js');

const fakeSupabase = (rows) => ({
  from: () => ({ select: () => ({ in: async () => ({ data: rows, error: null }) }) }),
});

describe('house parlay record per rule (owner 2026-10-15)', () => {
  test('the current rule is scored alone, the earlier rule rides as prior', async () => {
    const rows = [
      { status: 'won', rule: 'heavy_only' }, { status: 'lost', rule: 'heavy_only' }, { status: 'lost', rule: 'heavy_only' },
      { status: 'won', rule: CURRENT_RULE },
    ];
    const rec = await houseParlayRecord(fakeSupabase(rows));
    expect(rec).toMatchObject({ won: 1, lost: 0, hitRate: 100, rule: 'gimme_plus_value', since: '2026-10-15' });
    expect(rec.prior).toEqual({ rule: 'heavy_only', won: 1, lost: 2, hitRate: 33.3 });
  });

  test('no settled ticket under the new rule reads as no hit rate yet', () => {
    expect(tally([])).toEqual({ won: 0, lost: 0, hitRate: null });
  });
});
