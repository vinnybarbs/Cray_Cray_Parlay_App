-- 2026-10-20 (owner): "have an automated daily check and be literally
-- updating the agents directive directives if something downstream
-- changes". Directive 29.
--
-- Four parts:
--   1. system_inventory: what exists today (cron jobs, tables and views,
--      functions, dials from the database, repo files and server routes
--      from the server at every start). Diffed day over day it is the
--      record of what changed downstream.
--   2. downstream_drift_findings(): where a brief, a skill or a directive
--      no longer matches that inventory. refresh_system_inventory() keeps
--      downstream_drift_log current (first seen, resolved) so a finding
--      nobody fixed for 36 hours is directive 29's compliance check.
--   3. directive_history: every insert or update of a directive, before
--      and after, written by trigger whoever made it. One call
--      revert_directive_change(id) undoes any of them. The downstream
--      sync edits directives only through downstream_update_directive(),
--      which refuses a status change, an insert, a missing reason or a
--      check_sql that does not compile.
--   4. check_sql for the six active directives that had none (1, 6, 9,
--      10, 12, 19), directive 29 itself, and the daily refresh job.
--
-- No DELETE or DROP statements (the MCP confirmation quirk). The stale
-- agents/daily-build.md skills row is removed by the deploy sync, which
-- now deletes rows whose repo file is gone (lib/services/skill-sync.js).

-- 1. The inventory -------------------------------------------------------

create table if not exists public.system_inventory (
  kind text not null,
  name text not null,
  detail jsonb not null default '{}'::jsonb,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  changed_at timestamptz,
  removed_at timestamptz,
  primary key (kind, name)
);
alter table public.system_inventory enable row level security;

comment on table public.system_inventory is
  'What exists downstream (cron_job, table, function, dial from the database, file and route from the server). first_seen, changed_at and removed_at are the change record the downstream sync reads (directive 29).';

-- Upserts one kind's current list and marks what vanished. Used by the
-- database refresh for its own kinds and by the server for file and route.
create or replace function public.record_inventory_kind(p_kind text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added int := 0;
  v_changed int := 0;
  v_removed int := 0;
  v_returned int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('kind', p_kind, 'skipped', 'empty list');
  end if;

  with items as (
    select distinct on (x->>'name') x->>'name' as name, coalesce(x->'detail', '{}'::jsonb) as detail
      from jsonb_array_elements(p_items) x
     where coalesce(x->>'name', '') <> ''
  ), up as (
    insert into system_inventory as s (kind, name, detail)
    select p_kind, i.name, i.detail from items i
    on conflict (kind, name) do update
      set last_seen = now(),
          changed_at = case when s.detail is distinct from excluded.detail and s.removed_at is null then now() else s.changed_at end,
          first_seen = case when s.removed_at is not null then now() else s.first_seen end,
          removed_at = null,
          detail = excluded.detail
    returning (xmax = 0) as inserted, (changed_at = now()) as changed
  )
  select count(*) filter (where inserted), count(*) filter (where changed and not inserted)
    into v_added, v_changed from up;

  update system_inventory s
     set removed_at = now()
   where s.kind = p_kind
     and s.removed_at is null
     and not exists (
       select 1 from jsonb_array_elements(p_items) x where x->>'name' = s.name
     );
  get diagnostics v_removed = row_count;

  return jsonb_build_object('kind', p_kind, 'items', jsonb_array_length(p_items),
    'added', v_added, 'changed', v_changed, 'removed', v_removed);
end;
$$;

-- The server's half: repo files and routes, sent as plain name lists.
create or replace function public.record_code_inventory(p_kind text, p_names text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('file', 'route') then
    raise exception 'record_code_inventory takes file or route, not %', p_kind;
  end if;
  return record_inventory_kind(p_kind,
    (select coalesce(jsonb_agg(jsonb_build_object('name', n)), '[]'::jsonb) from unnest(p_names) n));
end;
$$;

-- 2. The findings --------------------------------------------------------

create table if not exists public.downstream_drift_log (
  drift text not null,
  subject text not null,
  detail text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_note text,
  primary key (drift, subject)
);
alter table public.downstream_drift_log enable row level security;

comment on table public.downstream_drift_log is
  'Every downstream_drift_findings() row with when it was first seen and when it cleared. acknowledged_at plus a note marks a mention the downstream sync judged intentionally historical. Directive 29 flags an open, unacknowledged row older than 36 hours.';

-- Where a brief, a skill or a directive no longer matches what exists.
-- Live, read only. Names shorter than six characters are never matched
-- (too many false hits).
create or replace function public.downstream_drift_findings()
returns table(drift text, subject text, detail text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_path_re constant text := '((?:lib|api|src|__tests__|supabase|agents|scripts|shared|\.claude)/[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.(?:js|jsx|ts|tsx|sql|md))';
  v_have_files boolean;
  r record;
begin
  select exists (select 1 from system_inventory where kind = 'file' and removed_at is null) into v_have_files;

  -- Something that existed is gone and a brief, skill or directive still
  -- names it (a removed file is the dead_path finding below instead).
  for r in
    with docs as (
      select 'skill ' || k.name as doc, k.content as body from skills k
      union all
      select 'directive ' || d.id, concat_ws(' ', d.directive, d.enforcement, d.check_sql, d.notes)
        from directives d where d.status = 'active'
    )
    select i.kind, i.name, i.removed_at, string_agg(docs.doc, ', ' order by docs.doc) as where_named
      from system_inventory i
      join docs on position(lower(case when i.kind = 'route' then regexp_replace(i.name, '^[A-Z]+ ', '') else i.name end) in lower(docs.body)) > 0
     where i.removed_at is not null and length(i.name) >= 6 and i.kind <> 'file'
     group by i.kind, i.name, i.removed_at
  loop
    drift := 'removed_still_named'; subject := r.kind || ' ' || r.name;
    detail := format('%s %s was removed on %s and is still named in %s. Correct the text or acknowledge it as history.',
      r.kind, r.name, r.removed_at::date, r.where_named);
    return next;
  end loop;

  -- Something new arrived after the inventory began and nothing documents it.
  for r in
    select i.kind, i.name, i.first_seen
      from system_inventory i
     where i.removed_at is null
       and length(i.name) >= 6
       and (i.kind in ('cron_job', 'table') or (i.kind = 'route' and i.name like '%/cron/%'))
       and i.first_seen > (select min(b.first_seen) from system_inventory b where b.kind = i.kind) + interval '1 hour'
       and not exists (select 1 from skills k where position(lower(
             case when i.kind = 'route' then regexp_replace(i.name, '^[A-Z]+ ', '') else i.name end) in lower(k.content)) > 0)
  loop
    drift := 'added_undocumented'; subject := r.kind || ' ' || r.name;
    detail := format('%s %s first appeared %s and no skill or brief names it. %s',
      r.kind, r.name, r.first_seen::date,
      case r.kind when 'cron_job' then 'Add it to the traphawk-ops-check section that witnesses it.'
                  when 'table' then 'Add it to traphawk-data-model.'
                  else 'Name it in the ops check or the data model skill.' end);
    return next;
  end loop;

  -- A cron schedule or a table shape changed this week and a doc describes it.
  for r in
    select i.kind, i.name, i.changed_at, i.detail,
           string_agg(k.name, ', ' order by k.name) as where_named
      from system_inventory i
      join skills k on position(lower(i.name) in lower(k.content)) > 0
     where i.removed_at is null and i.kind in ('cron_job', 'table')
       and i.changed_at > now() - interval '7 days' and length(i.name) >= 6
     group by i.kind, i.name, i.changed_at, i.detail
  loop
    drift := 'changed_recheck'; subject := r.kind || ' ' || r.name || ' ' || r.changed_at::date;
    detail := format('%s %s changed on %s%s. Recheck what %s says about it.',
      r.kind, r.name, r.changed_at::date,
      case when r.kind = 'cron_job' then ' (schedule now ' || coalesce(r.detail->>'schedule', '?') || case when (r.detail->>'active')::boolean then '' else ', inactive' end || ')' else '' end,
      r.where_named);
    return next;
  end loop;

  -- A repo path named in a directive or a doc that is not in the deployed tree.
  if v_have_files then
    for r in
      with docs as (
        select 'skill ' || k.name as doc, k.content as body from skills k
        union all
        select 'directive ' || d.id, concat_ws(' ', d.enforcement, d.check_sql, d.notes, d.directive)
          from directives d where d.status = 'active'
      )
      select m[1] as path, string_agg(distinct docs.doc, ', ') as where_named
        from docs, regexp_matches(docs.body, v_path_re, 'g') m
       where not exists (select 1 from system_inventory f where f.kind = 'file' and f.name = m[1] and f.removed_at is null)
       group by m[1]
    loop
      drift := 'dead_path'; subject := r.path;
      detail := format('%s names %s, which is not in the deployed repo. Point it at the file that does the work now.', r.where_named, r.path);
      return next;
    end loop;

    -- A skills row whose repo file is gone (the deploy sync deletes these).
    for r in
      select k.name from skills k
       where not exists (
         select 1 from system_inventory f
          where f.kind = 'file' and f.removed_at is null
            and f.name = case
              when k.name = 'AGENTS.md' then 'AGENTS.md'
              when k.name like 'agents/%' then k.name
              else '.claude/skills/' || k.name || '/SKILL.md' end)
    loop
      drift := 'orphan_skill_row'; subject := r.name;
      detail := format('skills row %s has no file in the repo. A routine loading it reads a dead brief. The next deploy sync removes it.', r.name);
      return next;
    end loop;
  end if;

  -- An active directive the daily ops check cannot test.
  for r in select d.id from directives d where d.status = 'active' and coalesce(btrim(d.check_sql), '') = '' loop
    drift := 'directive_without_check'; subject := 'directive ' || r.id;
    detail := 'Active directive with no check_sql, so the daily ops check skips it. Write one.';
    return next;
  end loop;
  return;
end;
$$;

-- The daily refresh: the database's own kinds, then the findings log.
create or replace function public.refresh_system_inventory()
returns jsonb
language plpgsql
security definer
set search_path = public, cron
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_open int;
  v_new int;
  v_resolved int;
begin
  v_out := v_out || record_inventory_kind('cron_job', (
    select coalesce(jsonb_agg(jsonb_build_object('name', j.jobname, 'detail', jsonb_build_object(
      'schedule', j.schedule, 'active', j.active,
      'command_md5', md5(regexp_replace(j.command, 'secret=[^&''" ]+', 'secret=x', 'g'))))), '[]'::jsonb)
      from cron.job j));

  v_out := v_out || record_inventory_kind('table', (
    select coalesce(jsonb_agg(jsonb_build_object('name', c.relname, 'detail', jsonb_build_object(
      'relkind', c.relkind,
      'columns_md5', (select md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum))
                        from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)))), '[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')));

  v_out := v_out || record_inventory_kind('function', (
    select coalesce(jsonb_agg(jsonb_build_object('name', f.proname, 'detail', jsonb_build_object('signatures_md5', f.sig))), '[]'::jsonb)
      from (
        select p.proname, md5(string_agg(pg_get_function_identity_arguments(p.oid), '|' order by pg_get_function_identity_arguments(p.oid))) as sig
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prokind = 'f'
           and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
         group by p.proname) f));

  v_out := v_out || record_inventory_kind('dial', (
    select coalesce(jsonb_agg(jsonb_build_object('name', s.dial, 'detail', jsonb_build_object('sports', s.sports))), '[]'::jsonb)
      from (select dial, jsonb_agg(sport order by sport) as sports from sport_dials group by dial) s));

  insert into downstream_drift_log as l (drift, subject, detail)
  select f.drift, f.subject, f.detail from downstream_drift_findings() f
  on conflict (drift, subject) do update
    set last_seen = now(), detail = excluded.detail,
        first_seen = case when l.resolved_at is not null then now() else l.first_seen end,
        acknowledged_at = case when l.resolved_at is not null then null else l.acknowledged_at end,
        acknowledged_note = case when l.resolved_at is not null then null else l.acknowledged_note end,
        resolved_at = null;
  get diagnostics v_open = row_count;

  select count(*) into v_new from downstream_drift_log where first_seen = now() and resolved_at is null;

  update downstream_drift_log l set resolved_at = now()
   where l.resolved_at is null
     and not exists (select 1 from downstream_drift_findings() f where f.drift = l.drift and f.subject = l.subject);
  get diagnostics v_resolved = row_count;

  return jsonb_build_object('kinds', v_out, 'open_findings', v_open, 'new_findings', v_new, 'resolved', v_resolved);
end;
$$;

-- 3. The directive change log and its guard ------------------------------

create table if not exists public.directive_history (
  id bigserial primary key,
  directive_id bigint not null,
  op text not null,
  source text not null,
  reason text,
  changed_fields text[] not null default '{}',
  before jsonb,
  after jsonb,
  changed_at timestamptz not null default now(),
  posted_at timestamptz
);
alter table public.directive_history enable row level security;

comment on table public.directive_history is
  'Every directive insert or update, before and after, by trigger. source is app.change_source (downstream-sync, revert, or manual). posted_at is set when api/cron/discord-directive-changes.js posts it to the Discord model channel. Undo any row with revert_directive_change(id).';

create or replace function public.directive_guard()
returns trigger
language plpgsql
as $$
declare
  v_source text := coalesce(nullif(current_setting('app.change_source', true), ''), 'manual');
begin
  if v_source = 'downstream-sync' then
    if tg_op = 'INSERT' then
      raise exception 'The downstream sync never adds a directive. A new rule is an owner call.';
    end if;
    if new.status is distinct from old.status then
      raise exception 'The downstream sync never changes a directive status (directive %). Expiring or reviving one is an owner call.', old.id;
    end if;
    if coalesce(btrim(current_setting('app.change_reason', true)), '') = '' then
      raise exception 'A downstream sync edit of directive % needs a reason with its evidence.', old.id;
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.directive_log_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fields text[];
  v_before jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) - 'created_at' - 'updated_at' end;
  v_after jsonb := to_jsonb(new) - 'created_at' - 'updated_at';
begin
  select coalesce(array_agg(k order by k), '{}') into v_fields
    from jsonb_object_keys(v_after) k
   where v_before is null or v_before->k is distinct from v_after->k;
  if tg_op = 'UPDATE' and cardinality(v_fields) = 0 then
    return null;
  end if;
  insert into directive_history (directive_id, op, source, reason, changed_fields, before, after)
  values (new.id, lower(tg_op),
          coalesce(nullif(current_setting('app.change_source', true), ''), 'manual'),
          nullif(current_setting('app.change_reason', true), ''),
          v_fields, v_before, v_after);
  return null;
end;
$$;

create or replace trigger trg_directive_guard
  before insert or update on public.directives
  for each row execute function public.directive_guard();

create or replace trigger trg_directive_history
  after insert or update on public.directives
  for each row execute function public.directive_log_change();

-- The only road the downstream sync uses to edit a directive. p_changes
-- may carry directive, enforcement, check_sql and notes, nothing else.
create or replace function public.downstream_update_directive(p_id bigint, p_changes jsonb, p_reason text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bad text;
  v_hist bigint;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'downstream_update_directive needs a reason with its evidence (the PR, the query, the file and line).';
  end if;
  select string_agg(k, ', ') into v_bad from jsonb_object_keys(p_changes) k
   where k not in ('directive', 'enforcement', 'check_sql', 'notes');
  if v_bad is not null then
    raise exception 'downstream_update_directive may change directive, enforcement, check_sql and notes only, not %', v_bad;
  end if;
  if not exists (select 1 from directives where id = p_id and status = 'active') then
    raise exception 'directive % is not active', p_id;
  end if;
  if p_changes ? 'check_sql' and coalesce(btrim(p_changes->>'check_sql'), '') <> '' then
    begin
      execute 'select 1 from (' || (p_changes->>'check_sql') || ') q limit 0';
    exception when others then
      raise exception 'check_sql for directive % does not compile: %', p_id, sqlerrm;
    end;
  end if;

  perform set_config('app.change_source', 'downstream-sync', true);
  perform set_config('app.change_reason', p_reason, true);
  update directives set
    directive = case when p_changes ? 'directive' then p_changes->>'directive' else directive end,
    enforcement = case when p_changes ? 'enforcement' then p_changes->>'enforcement' else enforcement end,
    check_sql = case when p_changes ? 'check_sql' then nullif(btrim(p_changes->>'check_sql'), '') else check_sql end,
    notes = case when p_changes ? 'notes' then p_changes->>'notes' else notes end
  where id = p_id;
  perform set_config('app.change_source', '', true);
  perform set_config('app.change_reason', '', true);

  select max(id) into v_hist from directive_history where directive_id = p_id;
  return v_hist;
end;
$$;

-- One call undoes any logged change: an update goes back to its before
-- row, an insert expires the directive it added.
create or replace function public.revert_directive_change(p_history_id bigint, p_reason text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  h directive_history%rowtype;
  v_hist bigint;
begin
  select * into h from directive_history where id = p_history_id;
  if not found then
    raise exception 'directive_history row % not found', p_history_id;
  end if;
  perform set_config('app.change_source', 'revert', true);
  perform set_config('app.change_reason', coalesce(p_reason, 'revert of directive_history ' || p_history_id), true);
  if h.op = 'insert' then
    update directives set status = 'expired' where id = h.directive_id;
  else
    update directives set
      directive = h.before->>'directive',
      status = h.before->>'status',
      enforcement = h.before->>'enforcement',
      check_sql = h.before->>'check_sql',
      notes = h.before->>'notes',
      decided_on = (h.before->>'decided_on')::date
    where id = h.directive_id;
  end if;
  perform set_config('app.change_source', '', true);
  perform set_config('app.change_reason', '', true);
  select max(id) into v_hist from directive_history where directive_id = h.directive_id;
  return v_hist;
end;
$$;

revoke all on function public.record_inventory_kind(text, jsonb) from public, anon, authenticated;
revoke all on function public.record_code_inventory(text, text[]) from public, anon, authenticated;
revoke all on function public.downstream_drift_findings() from public, anon, authenticated;
revoke all on function public.refresh_system_inventory() from public, anon, authenticated;
revoke all on function public.downstream_update_directive(bigint, jsonb, text) from public, anon, authenticated;
revoke all on function public.revert_directive_change(bigint, text) from public, anon, authenticated;
grant execute on function public.record_code_inventory(text, text[]) to service_role;
grant execute on function public.refresh_system_inventory() to service_role;
grant execute on function public.downstream_drift_findings() to service_role;

-- 4. The six missing checks, directive 29, and the schedule -------------

select set_config('app.change_source', 'migration 20261020040000_downstream_sync', true);
select set_config('app.change_reason', 'owner 2026-10-20: every active directive gets a check_sql so the daily ops check tests it', true);

update public.directives set check_sql = $c$select ga.sport || ' ' || count(*) || ' reads with a moneyline pair not anchored to the market in 2 days' as violation from game_analysis ga where ga.generated_at > now() - interval '2 days' and ga.sport in ('NFL', 'NCAAF', 'NBA', 'NCAAB', 'NHL', 'MLB') and ga.moneyline_home is not null and ga.moneyline_away is not null and ga.edge_factors is not null and coalesce(ga.edge_factors->>'marketAnchored', 'false') <> 'true' group by ga.sport$c$
 where id = 1;

update public.directives set check_sql = $c$select 'settlement write once trigger missing or disabled' as violation where not exists (select 1 from pg_trigger where tgname = 'trg_settlement_write_once' and tgrelid = 'public.ai_suggestions'::regclass and tgenabled <> 'D') union all select 'ledger rows with game_date before 2026-07-01 modified in 2 days: ' || count(*) from ai_suggestions where game_date < '2026-07-01' and updated_at > now() - interval '2 days' having count(*) > 0$c$
 where id = 6;

update public.directives set check_sql = $c$select m.sport || ' weight change ' || m.id || ' on ' || m.changed_at::date || ' marks a new regime but the fit floor is ' || coalesce(f.fit_floor::text, 'missing') as violation from model_weight_changes m left join band_fit_floors f on f.sport = m.sport where m.changed_at > now() - interval '30 days' and m.sport not like '%\_props' and (m.reason ilike '%new regime%' or m.reason ilike '%directive 9%' or m.source ilike '%regime%') and (f.fit_floor is null or f.fit_floor < m.changed_at::date)$c$
 where id = 9;

update public.directives set check_sql = $c$select d.sport || ' ' || d.dial || ' live since ' || d.updated_at::date || ' and no calibration-review row in 8 days names the sport' as violation from sport_dials d where d.dial like 'publish\_%' and d.sport <> '__all__' and d.value::numeric = 1 and d.updated_at > now() - interval '90 days' and not exists (select 1 from agent_reports a where a.agent = 'calibration-review' and a.created_at > now() - interval '8 days' and (a.summary ilike '%' || d.sport || '%' or a.findings::text ilike '%' || d.sport || '%'))$c$
 where id = 10;

update public.directives set check_sql = $c$select 'NFL totals publishing with no owner row since the 2026-09-21 mute' as violation where coalesce((select value::numeric from sport_dials where sport = 'NFL' and dial = 'publish_total'), (select value::numeric from sport_dials where sport = '__all__' and dial = 'publish_total'), 1) <> 0 and not exists (select 1 from model_weight_changes where sport = 'NFL' and component ilike '%publish_total%' and changed_at > '2026-09-22' and source ilike 'owner%')$c$
 where id = 12;

update public.directives set check_sql = $c$select ga.sport || ' ' || count(*) || ' anchored reads still carrying home advantage in 2 days (a double count)' as violation from game_analysis ga where ga.generated_at > now() - interval '2 days' and ga.edge_factors->>'marketAnchored' = 'true' and coalesce((ga.edge_factors->>'homeAdvantage')::numeric, 0) <> 0 group by ga.sport$c$
 where id = 19;

select set_config('app.change_reason', 'owner 2026-10-20: "have an automated daily check and be literally updating the agents directive directives if something downstream changes"', true);

-- directives.id is an identity column, so the row takes the next id (29).
insert into public.directives (directive, decided_on, status, enforcement, check_sql, notes)
select
  'Nothing downstream drifts, and nobody has to remember to fix it. Every day the downstream sync reads what changed since its last run (merged pull requests, cron jobs, tables, functions, dials, repo files and server routes, from system_inventory and downstream_drift_findings()) and itself updates every agent brief, skill and directive the change made wrong: briefs and skills by a merged pull request, directives in place. It does not ask first. Every directive edit is logged before and after in directive_history, posted to the Discord model channel, and undone with one call to revert_directive_change(id). The sync corrects facts and carries through changes the owner already made. It never loosens, expires or adds a directive on its own reading, and a change that contradicts a directive with no owner decision behind it goes to the owner as a call.',
  '2026-10-20', 'active',
  'agents/downstream-sync.md, run every morning by the exec assistant. public.refresh_system_inventory() (pg_cron refresh-system-inventory daily 13:30 UTC, and at every server start after lib/services/system-inventory.js records repo files and routes). public.downstream_drift_findings() and downstream_drift_log. Triggers trg_directive_guard and trg_directive_history on directives, edits through public.downstream_update_directive(). api/cron/discord-directive-changes.js posts every directive_history row. This check_sql flags a finding left open and unacknowledged 36 hours.',
  $c$select l.drift, l.subject, l.detail from downstream_drift_log l where l.resolved_at is null and l.acknowledged_at is null and l.first_seen < now() - interval '36 hours' union all select 'inventory_stale', 'system_inventory', 'refresh_system_inventory has not run in 30 hours' where coalesce((select max(last_seen) from system_inventory where kind = 'cron_job'), '-infinity'::timestamptz) < now() - interval '30 hours'$c$,
  'Owner 2026-10-20 in the project thread on daily jobs: the briefs and directives must follow downstream changes automatically. Before this the exec assistant swept brief facts only and never touched a directive, nothing changed a directive without the owner, and six active directives had no check.'
where not exists (select 1 from public.directives where directive like 'Nothing downstream drifts%');

select set_config('app.change_source', '', true);
select set_config('app.change_reason', '', true);

-- The daily refresh lands before the 14:00 UTC ops check. SQL only.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'refresh-system-inventory') then
    perform cron.unschedule('refresh-system-inventory');
  end if;
  perform cron.schedule('refresh-system-inventory', '30 13 * * *', 'select public.refresh_system_inventory()');
end $$;

-- Every directive change reaches the Discord model channel within the hour.
do $$
declare
  v_secret text;
begin
  select substring(command from 'secret=([^&'']+)') into v_secret
    from cron.job where jobname = 'discord-morning-board' limit 1;
  if v_secret is null then
    raise exception 'discord-morning-board job not found, cannot read the cron secret';
  end if;
  if exists (select 1 from cron.job where jobname = 'discord-directive-changes') then
    perform cron.unschedule('discord-directive-changes');
  end if;
  perform cron.schedule('discord-directive-changes', '20 * * * *', format($j$
    SELECT net.http_post(
      url := 'https://craycrayparlayapp-production.up.railway.app/cron/discord-directive-changes?secret=%s',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb, timeout_milliseconds := 60000);
  $j$, v_secret));
end $$;

-- First inventory from the database side (files and routes follow at the
-- next server start).
select public.refresh_system_inventory();
