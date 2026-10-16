/**
 * Restart safety for the data integrity sweep (ops check 2026-10-16).
 *
 * The sweep answers its cron call with a 202 and runs in the background for
 * four to nine minutes. A deploy that restarts the server inside that window
 * kills the run: the started row stays without a terminal row and no intel
 * is written (2026-10-16 04:45 MT, killed by the 04:46 deploy of 1767bd8).
 *
 * On every server start, after a wait long enough for a run on the old
 * container to finish or die, this closes each started row that never got a
 * terminal row with a failed row (reason interrupted_by_restart) and, when
 * the dead run began inside the last hour, runs the sweep once more. A run
 * that was itself a resume is never resumed again, so a deploy loop costs
 * at most one extra sweep per interrupted cron fire.
 */

'use strict';

const JOB = 'data_integrity_sweep';
// Longer than the slowest observed run (8m40s on 2026-10-14) so a run still
// finishing on the old container is never called dead.
const DEAD_AFTER_MS = 15 * 60 * 1000;
const RESUME_WITHIN_MS = 60 * 60 * 1000;
const LOOKBACK_MS = 6 * 3600 * 1000;

function parseDetails(d) {
  if (d && typeof d === 'object') return d;
  try { return JSON.parse(d) || {}; } catch { return {}; }
}

/**
 * Pure: given the sweep's cron_job_logs rows (any order), return the started
 * rows with no later row of their own. Runs never overlap (two cron fires a
 * day, hours apart), so any later non started row closes the run before it.
 * A row matched by run_id closes it too.
 */
function findInterruptedRuns(rows, nowMs) {
  const sorted = [...rows].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const out = [];
  sorted.forEach((row, i) => {
    if (row.status !== 'started') return;
    const startedMs = new Date(row.created_at).getTime();
    if (nowMs - startedMs < DEAD_AFTER_MS) return;
    const details = parseDetails(row.details);
    const runId = details.run_id || null;
    const closed = sorted.slice(i + 1).some((r) => {
      if (r.status === 'started') return false;
      const rid = parseDetails(r.details).run_id;
      return !rid || rid === runId;
    });
    if (closed) return;
    out.push({
      run_id: runId,
      started_at: row.created_at,
      resumed_from: details.resumed_from || null,
      resume: !details.resumed_from && nowMs - startedMs <= RESUME_WITHIN_MS,
    });
  });
  return out;
}

async function recoverInterruptedSweeps(supabase, { runSweep, now = () => Date.now() } = {}) {
  const nowMs = now();
  const { data, error } = await supabase
    .from('cron_job_logs')
    .select('created_at, status, details')
    .eq('job_name', JOB)
    .gte('created_at', new Date(nowMs - LOOKBACK_MS).toISOString());
  if (error) throw new Error(`sweep recovery read failed: ${error.message}`);

  const dead = findInterruptedRuns(data || [], nowMs);
  let resumed = 0;
  for (const run of dead) {
    await supabase.from('cron_job_logs').insert({
      job_name: JOB,
      status: 'failed',
      details: {
        run_id: run.run_id,
        reason: 'interrupted_by_restart',
        started_at: run.started_at,
        resumed: run.resume,
      },
    });
    if (run.resume && runSweep && resumed === 0) {
      resumed += 1;
      await runSweep({ resumedFrom: run.run_id });
    }
  }
  return { interrupted: dead.length, resumed };
}

module.exports = { findInterruptedRuns, recoverInterruptedSweeps, DEAD_AFTER_MS, RESUME_WITHIN_MS };
