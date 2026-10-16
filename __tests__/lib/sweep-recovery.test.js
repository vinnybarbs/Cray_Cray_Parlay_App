// A deploy inside a data integrity sweep killed the 2026-10-16 04:45 MT run
// (started row, no terminal row, no intel). Boot recovery closes such runs
// with a failed row and resumes each one once.

const { findInterruptedRuns, recoverInterruptedSweeps, DEAD_AFTER_MS } = require('../../lib/services/sweep-recovery');

const T = (iso) => new Date(iso).getTime();
const started = (at, extra = {}) => ({
  created_at: at, status: 'started', details: { run_id: at, games_on_board: 14, ...extra },
});

describe('findInterruptedRuns', () => {
  test('the 2026-10-16 case: a started row with no terminal row is dead and resumes', () => {
    const rows = [started('2026-10-16T10:45:00.853Z')];
    const out = findInterruptedRuns(rows, T('2026-10-16T11:02:37Z'));
    expect(out).toEqual([{
      run_id: '2026-10-16T10:45:00.853Z', started_at: '2026-10-16T10:45:00.853Z',
      resumed_from: null, resume: true,
    }]);
  });

  test('a run closed by its own success row is left alone', () => {
    const rows = [
      started('2026-10-15T17:00:17.276Z'),
      { created_at: '2026-10-15T17:04:44Z', status: 'success', details: JSON.stringify({ run_id: '2026-10-15T17:00:17.276Z' }) },
    ];
    expect(findInterruptedRuns(rows, T('2026-10-15T18:00:00Z'))).toEqual([]);
  });

  test('a run still inside the dead window is never called dead', () => {
    const at = '2026-10-16T10:45:00Z';
    expect(findInterruptedRuns([started(at)], T(at) + DEAD_AFTER_MS - 1000)).toEqual([]);
  });

  test('an already failed run is not closed twice', () => {
    const at = '2026-10-16T10:45:00Z';
    const rows = [started(at), { created_at: '2026-10-16T11:02:00Z', status: 'failed', details: { run_id: at, reason: 'interrupted_by_restart' } }];
    expect(findInterruptedRuns(rows, T('2026-10-16T12:00:00Z'))).toEqual([]);
  });

  test('a resumed run that dies is closed but never resumed again', () => {
    const at = '2026-10-16T11:02:00Z';
    const out = findInterruptedRuns([started(at, { resumed_from: '2026-10-16T10:45:00Z' })], T('2026-10-16T11:30:00Z'));
    expect(out).toHaveLength(1);
    expect(out[0].resume).toBe(false);
  });

  test('a dead run older than an hour is closed without a resume', () => {
    const at = '2026-10-16T10:45:00Z';
    const out = findInterruptedRuns([started(at)], T('2026-10-16T12:00:00Z'));
    expect(out[0].resume).toBe(false);
  });
});

describe('recoverInterruptedSweeps', () => {
  function fakeSupabase(rows) {
    const inserts = [];
    return {
      inserts,
      from: () => ({
        select: () => ({ eq: () => ({ gte: async () => ({ data: rows, error: null }) }) }),
        insert: async (row) => { inserts.push(row); return { error: null }; },
      }),
    };
  }

  test('writes one failed row and resumes once', async () => {
    const at = '2026-10-16T10:45:00.853Z';
    const sb = fakeSupabase([started(at)]);
    const runSweep = jest.fn(async () => ({}));
    const r = await recoverInterruptedSweeps(sb, { runSweep, now: () => T('2026-10-16T11:02:37Z') });
    expect(r).toEqual({ interrupted: 1, resumed: 1 });
    expect(sb.inserts[0]).toMatchObject({ job_name: 'data_integrity_sweep', status: 'failed', details: { run_id: at, reason: 'interrupted_by_restart', resumed: true } });
    expect(runSweep).toHaveBeenCalledWith({ resumedFrom: at });
  });

  test('a healthy log does nothing', async () => {
    const sb = fakeSupabase([]);
    const runSweep = jest.fn();
    expect(await recoverInterruptedSweeps(sb, { runSweep })).toEqual({ interrupted: 0, resumed: 0 });
    expect(runSweep).not.toHaveBeenCalled();
    expect(sb.inserts).toEqual([]);
  });
});
