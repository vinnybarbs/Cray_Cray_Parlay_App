// __tests__/lib/ufc-data.test.js
//
// Pure-function tests for the UFC data service. No network, no Supabase.

'use strict';

const {
  recordFromRecordsPayload,
  summarizeFighter,
  formatUfcContext,
} = require('../../lib/services/ufc-data');

describe('recordFromRecordsPayload', () => {
  test('prefers the overall record entry', () => {
    const payload = {
      items: [
        { type: 'ufc', summary: '10-1-0' },
        { type: 'overall', summary: '23-2-0' },
      ],
    };
    expect(recordFromRecordsPayload(payload)).toBe('23-2-0');
  });

  test('falls back to the first entry with a summary', () => {
    expect(recordFromRecordsPayload({ items: [{ name: 'x' }, { name: 'y', summary: '5-0-0' }] })).toBe('5-0-0');
  });

  test('tolerates empty payloads', () => {
    expect(recordFromRecordsPayload({})).toBeNull();
    expect(recordFromRecordsPayload(null)).toBeNull();
  });
});

describe('summarizeFighter', () => {
  const iso = (daysBack) => new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  test('builds recent lines and layoff from stored fights', () => {
    const fights = [
      { winner_key: 'a b', winner_name: 'A B', loser_key: 'x y', loser_name: 'X Y', fight_date: iso(30), event: 'UFC 300' },
      { winner_key: 'z w', winner_name: 'Z W', loser_key: 'a b', loser_name: 'A B', fight_date: iso(200), event: 'UFC 295' },
    ];
    const s = summarizeFighter('A B', 'a b', { record: '23-2-0' }, fights);
    expect(s.record).toBe('23-2-0');
    expect(s.recentLines[0]).toContain('W vs X Y');
    expect(s.recentLines[1]).toContain('L vs Z W');
    expect(s.layoffDays).toBeGreaterThanOrEqual(29);
    expect(s.layoffDays).toBeLessThanOrEqual(31);
  });

  test('empty inputs give null record and no lines', () => {
    const s = summarizeFighter('C D', 'c d', null, []);
    expect(s.record).toBeNull();
    expect(s.recentLines).toEqual([]);
    expect(s.layoffDays).toBeNull();
  });
});

describe('formatUfcContext', () => {
  test('renders records, layoff, and no-h2h line', () => {
    const ctx = {
      home: { name: 'Denis Goltsov', key: 'denis goltsov', record: '25-3-0', recentLines: ['W vs A (Jan 2, 2026, UFC 310)'], lastFightDate: '2026-01-02', layoffDays: 215 },
      away: { name: 'Hasan Mezhiev', key: 'hasan mezhiev', record: '12-1-0', recentLines: [], lastFightDate: null, layoffDays: null },
      h2h: [],
    };
    const out = formatUfcContext(ctx);
    expect(out).toContain('career record 25-3-0');
    expect(out).toContain('career record 12-1-0');
    expect(out).toContain('215 days ago');
    expect(out).toContain('no prior meeting');
  });

  test('returns null when neither fighter has data', () => {
    const empty = { name: 'X', key: 'x', record: null, recentLines: [], lastFightDate: null, layoffDays: null };
    expect(formatUfcContext({ home: empty, away: { ...empty, name: 'Y', key: 'y' }, h2h: [] })).toBeNull();
    expect(formatUfcContext(null)).toBeNull();
  });
});
