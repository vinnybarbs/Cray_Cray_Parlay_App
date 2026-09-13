-- Nothing changes in a vacuum (owner, 2026-09-13): the mechanical half.
--
-- The human half is the propagation table in the traphawk-ship skill.
-- This function checks, every day through directive 22, the drift that
-- can be checked from the database: a dial on the board that no skill
-- names, an active directive whose enforcement names a function that no
-- longer exists, and a directive check_sql that no longer runs. First
-- run found eight undocumented dials.

create or replace function public.doc_drift_findings()
returns table (drift text, subject text, detail text)
language plpgsql stable
as $$
declare
  d record;
  ok boolean;
begin
  -- 1. Dials on the board that no skill mentions.
  for d in
    select distinct s.dial from sport_dials s
     where not exists (select 1 from skills k where k.content ilike '%' || s.dial || '%')
     order by s.dial
  loop
    drift := 'dial_undocumented'; subject := d.dial;
    detail := format('sport_dials carries %s and no skill in the skills table names it; add it to the performance review dial list', d.dial);
    return next;
  end loop;

  -- 2. Active directives whose enforcement names a public function that is gone.
  for d in
    select dv.id, dv.enforcement, m[1] as fn
      from directives dv, regexp_matches(dv.enforcement, 'public\.([a-z_]+)\(', 'g') as m
     where dv.status = 'active'
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = d.fn) then
      drift := 'dead_enforcement'; subject := 'directive ' || d.id;
      detail := format('enforcement names public.%s() which does not exist', d.fn);
      return next;
    end if;
  end loop;

  -- 3. Directive check_sql that no longer executes.
  for d in select dv.id, dv.check_sql from directives dv where dv.status = 'active' and dv.check_sql is not null loop
    ok := true;
    begin
      execute 'select 1 from (' || d.check_sql || ') q limit 0';
    exception when others then
      ok := false;
      drift := 'broken_check_sql'; subject := 'directive ' || d.id;
      detail := left(sqlerrm, 200);
      return next;
    end;
  end loop;
  return;
end;
$$;

comment on function public.doc_drift_findings() is
  'Directive 22: documentation and enforcement drift the database can see. Undocumented dials, dead enforcement functions, broken directive checks.';

insert into directives (directive, decided_on, enforcement, check_sql, notes, status)
values (
  'Nothing changes in a vacuum. Every change moves every surface that sees it, per the propagation table in the traphawk-ship skill (dials: board, model_weight_changes, review skill, Edge Anatomy, code default; rules: directives, ops check, code constant, client mirror, mirror test; formulas: directive 19 audit, band regime, review skill, Edge Anatomy, replay; tables: data model skill, readers, tripwires; always: blackboard row, build queue). The mechanical part runs daily: an undocumented dial, a dead enforcement function, or a broken directive check is a finding.',
  '2026-09-13',
  'traphawk-ship propagation table (human); public.doc_drift_findings() via this check_sql (mechanical); __tests__/lib/drift.test.js (mirrors at test time)',
  'select drift, subject, detail from public.doc_drift_findings()',
  'Owner 2026-09-13: "a skill that tells you to update everywhere that anything else sees so we never make changes in a vacuum". First run: eight dials on the board named in no skill.',
  'active'
);
