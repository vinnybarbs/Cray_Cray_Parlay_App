-- Owner 2026-09-28: "create an Agents.MD directive compiling all our
-- goals and skills and objectives and no-no's as a top line for you and
-- agents to consume before sessions."
--
-- AGENTS.md lives at the repo root, is edited only there (directive 15),
-- and syncs into the skills table as its own row (name AGENTS.md) on
-- every deploy, so a cloud routine reads the same text the code session
-- reads. Every session, human or routine, reads it before its skill.

insert into public.directives (directive, decided_on, status, enforcement, check_sql, notes) values
  ('AGENTS.md is the top line. Every session and every routine reads it first (the repo file for a code session, the AGENTS.md row of the skills table for a routine), before its skill, before the blackboard. It compiles the goals, the four state tables, the skills index, the change protocol, the never list and the session checklists. It is edited only in the repo and synced by every deploy; a change to a goal, a rule or a skill that AGENTS.md summarizes updates AGENTS.md in the same change.',
   '2026-09-28', 'active',
   'lib/services/skill-sync.js syncs AGENTS.md as the skills row named AGENTS.md at server start; the ops check and performance review skills open with the read; CLAUDE.md points at it.',
   $chk$select 'AGENTS.md row missing from the skills table', 'AGENTS.md' where not exists (select 1 from skills where name = 'AGENTS.md')
union all select 'AGENTS.md row older than the latest skill sync', name from skills where name = 'AGENTS.md' and synced_at < (select max(synced_at) from skills where name <> 'AGENTS.md') - interval '1 minute'$chk$,
   'Filed with the two 2026-09-28 reports (TrapHawk Model and Site Plan, TrapHawk Lookback Engine and Business Plan).');

insert into public.build_queue (priority, status, title, detail) values
  ('medium', 'done', 'AGENTS.md: the compiled top line (goals, state tables, skills, change protocol, never list, checklists) synced as a skills row and read first by every session',
   'Owner 2026-09-28. Repo root AGENTS.md, synced by skill-sync as the AGENTS.md row, referenced from CLAUDE.md and the ops check and review skills, directive 26 with a check_sql for a missing or stale row.');
