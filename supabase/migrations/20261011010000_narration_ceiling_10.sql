-- 2026-10-11 (owner): "change narration ceiling to 10 for football season
-- and with props coming 6 is too low". The 6.00 figure (owner 2026-08-18)
-- was a constant in the ops check skill, never a directive. This row
-- makes the ceiling a standing decision with its own check, in force
-- from 2026-10-11 until football ends, when the exec assistant brings
-- it back to the owner.
insert into public.directives (directive, decided_on, status, enforcement, check_sql, notes) values
('The narration cost ceiling is 10.00 dollars per day for football season, from 2026-10-11 until football ends. A day above it is a cost regression and a finding. A day between 6 and 10 is not a finding.',
 '2026-10-11', 'active',
 'traphawk-ops-check skill section 2 (the cost and change gate query) and this check. The exec assistant brings the ceiling back to the owner for review when football ends.',
 $q$select day::text || ' narration cost ' || narration_cost::text || ' over the 10.00 ceiling' as name from (select date(created_at) as day, round(sum((details::jsonb->>'cost')::numeric), 2) as narration_cost from cron_job_logs where job_name like 'pre-analyze%' and status in ('completed', 'partial') and created_at >= now() - interval '7 days' group by 1) d where narration_cost > 10$q$,
 'Owner 2026-10-11: "change narration ceiling to 10 for football season and with props coming 6 is too low". The 6.00 ceiling (owner 2026-08-18) was a skill constant, never a directive. The 7.37 on 10-09 and 6.28 on 10-10 breaches are closed by this row.');
