# Scheduled TrapHawk routines

Last verified 2026-08-30.

Three scheduled tasks run TrapHawk ops work on their own. Each one fires a fresh Claude session with push notifications on, loads a project skill, and queries Supabase project `pcjhulzyqmhrhsrgvwvx`. Each run is read only apart from one insert into `agent_reports`.

## The routines

| Routine | Cron (UTC) | Local MT | Skill it calls | Trigger ID |
|---|---|---|---|---|
| TrapHawk daily ops check | `0 14 * * *` | 8:00am daily | traphawk-ops-check | trig_015qoYxVhMJyekxCgUaV1atQ |
| TrapHawk weekly calibration review | `0 12 * * 1` | 6:00am Mondays | traphawk-performance-review | trig_01XdGMb6AvwbjCHJWNGJPTFn |
| TrapHawk monthly API cost audit | `0 15 2 * *` | 9:00am on the 2nd | traphawk-cost-audit | trig_01LP5t3AcowYb1vXr7XSNdCW |

All three also load traphawk-data-model for schema and tier definitions.

## Not scheduled

- traphawk-ship. Runs only when a code change is being built, tested, migrated, or deployed.
- traphawk-data-model. Never a routine on its own, always a prerequisite for the other four.

## Overlap

The weekly runs two hours ahead of the daily. The daily sits one hour ahead of the monthly. Nothing shares a window.

The weekly and the monthly used to collide whenever the 1st fell on a Monday. The monthly moved to the 2nd on 2026-08-30, and the weekly moved from 9am to 6am MT the same day. The next collisions under the old schedule would have been 2027-02-01, 2027-03-01, 2027-11-01 and 2028-05-01, with the two sessions firing four minutes apart against the same database and both writing to `agent_reports`.

Before adding a fourth routine, check it against this table. Two TrapHawk sessions in the same window read each other's half-written `agent_reports` state.

## Daylight saving

Cron runs in UTC and does not follow Mountain time. These expressions were written for MDT at UTC-6. On 2026-11-01 Mountain time returns to MST at UTC-7 and every routine fires one hour earlier in local terms.

To hold 6am, 8am and 9am MT after 2026-11-01, set the daily to `0 15 * * *`, the weekly to `0 13 * * 1`, and the monthly to `0 16 2 * *`. Reverse it when DST resumes in March.

## Skill drift

The canonical `.skill` files live in this repo root. The account skill copies that sync into Claude sessions lag until the delivered `.skill` file is saved. If a synced skill contradicts the repo file, the repo file wins.

Status as of 2026-08-30. All five match the repo byte for byte. traphawk-cost-audit was behind by the agent_reports read and insert paragraph and was re-saved on 2026-08-30.

## How to change a routine

Edit the skill, not the trigger prompt. Only edit the trigger for schedule, scope, which skill it calls, or what the run is permitted to write. Keep the trigger's write carve-out in sync with what the skill's final report step needs.

Each prompt tells the run to say so at the top of its report if the skill did not load. A report that opens with that line means the skill never reached the scheduled session.
