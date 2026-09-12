// NFL preseason never feeds the model (2026-09-12: week-one tiles were
// built from August exhibition games).

const { regularSeasonFloor, withSeasonFloor, seasonYear } = require('../../lib/services/season-floor');
const { EdgeCalculator } = require('../../lib/services/edge-calculator');

describe('regularSeasonFloor', () => {
  test('NFL floors at the opener for the season in progress', () => {
    expect(regularSeasonFloor('NFL', new Date('2026-09-12T00:00:00Z'))).toBe('2026-09-10');
    expect(regularSeasonFloor('NFL', new Date('2026-08-20T00:00:00Z'))).toBe('2026-09-10');
    expect(regularSeasonFloor('NFL', new Date('2027-01-15T00:00:00Z'))).toBe('2026-09-10');
    expect(regularSeasonFloor('NFL', new Date('2029-09-15T00:00:00Z'))).toBe('2029-09-01');
  });
  test('other sports have no floor', () => {
    expect(regularSeasonFloor('MLB')).toBeNull();
    expect(regularSeasonFloor('NCAAF')).toBeNull();
  });
  test('season year rolls in August', () => {
    expect(seasonYear(new Date('2026-07-31T00:00:00Z'))).toBe(2025);
    expect(seasonYear(new Date('2026-08-01T00:00:00Z'))).toBe(2026);
  });
  test('withSeasonFloor adds the gte only when a floor exists', () => {
    const calls = [];
    const q = { gte: (c, v) => { calls.push([c, v]); return q; } };
    expect(withSeasonFloor(q, 'MLB')).toBe(q);
    expect(calls).toEqual([]);
    withSeasonFloor(q, 'NFL', new Date('2026-09-12T00:00:00Z'));
    expect(calls).toEqual([['date', '2026-09-10']]);
  });
});

describe('the calculator reads football results above the floor', () => {
  test('getTeamRecord passes the NFL floor to game_results', async () => {
    const calls = [];
    const fb = {};
    for (const m of ['select', 'eq', 'or', 'order', 'gte', 'lt']) fb[m] = (...a) => { calls.push([m, ...a]); return fb; };
    fb.limit = () => Promise.resolve({ data: [], error: null });
    const calc = new EdgeCalculator({ from: () => fb });
    await calc.getTeamRecord('Houston Texans', 'NFL', 20);
    expect(calls.some(c => c[0] === 'gte' && c[1] === 'date' && c[2] === '2026-09-10')).toBe(true);
    calls.length = 0;
    await calc.getTeamRecord('Boston Red Sox', 'MLB', 20);
    expect(calls.some(c => c[0] === 'gte' && c[1] === 'date' && c[2] === '1900-01-01')).toBe(true);
  });
});
