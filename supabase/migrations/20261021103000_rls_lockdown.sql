-- RLS lockdown for the public schema.
--
-- Audit 2026-10-21: 12 tables had RLS off (directives, sport_dials,
-- build_queue, model_weight_changes, skills, llm_jobs and others), so
-- anyone holding the public anon key could read AND write them over
-- the REST API. 13 views ran as SECURITY DEFINER and exposed ledger
-- data to anon. Every table and view also carried full anon and
-- authenticated grants.
--
-- Who actually needs the anon key: only the browser, and it only
-- touches auth plus tracked_bets (owner policies). The Express server,
-- cron endpoints, edge functions and routines all use the service role
-- or postgres, which bypass RLS and keep their own grants.
--
-- So: RLS on everywhere, strip anon and authenticated grants from every
-- relation, then grant back only the owner scoped user tables and the
-- public record MV.

-- 1. RLS on for every public table that still has it off.
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end $$;

-- 2. No direct anon or authenticated access to any table, view or MV.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon;

-- 3. Views run with the caller's permissions, not the owner's.
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('alter view public.%I set (security_invoker = true)', r.relname);
  end loop;
end $$;

-- 4. Grant back what signed in users need. Each table's policies scope
-- rows to auth.uid() = user_id.
grant select, insert, update, delete on public.tracked_bets to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.parlays to authenticated;
grant select, insert, update, delete on public.parlay_legs to authenticated;
grant select on public.subscriptions to authenticated;

-- Public record numbers stay readable (CLAUDE.md rule for this MV).
grant select on public.mv_public_record to anon, authenticated, service_role;

-- 5. ai_suggestions is the pick ledger, server only. Its select policy
-- let anyone read every row.
drop policy if exists ai_suggestions_select_public on public.ai_suggestions;

-- 6. Trigger function that was callable over /rest/v1/rpc.
revoke execute on function public.directive_log_change() from public, anon, authenticated;

-- 7. New tables and views made by migrations start closed. A table the
-- browser must read directly needs an explicit grant plus policies.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;
