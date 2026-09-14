-- Monday 2026-09-14: what the first automated weekend found, fixed.
--
-- 1. The weekly multiplier refit floors every key at 0.25, so it lifted
--    the MLB:total mute (directive 10, model_weight_changes 17) at 00:30
--    with no weight change row, and ten MLB total picks published
--    against the mute. A muted key (multiplier 0) is now never touched
--    by the refit; re-entry goes through promote_ready_markets or the
--    owner. The mute is restored and the pending rows are voided.
-- 2. The weekly band refit failed: two overloads of
--    refresh_edge_band_calibration_raw made the named-argument call
--    ambiguous. The older six-argument overload is dropped.
-- 3. The Sunday sweep filed build_queue 34 with an empty dial payload
--    (the endpoint did not pass the variants) and a test 1 that passed
--    on 5 wins out of 167 base losers. Test 1 now requires the variant
--    to turn at least ten percent of base's losers, and the row states
--    the current dial value and the directive 8 capped first step.
-- 4. doc_drift_findings gains a wire for a recorded mute the live
--    multiplier no longer honors, so the next lifted mute is a finding.

-- 2. One overload.
drop function if exists public.refresh_edge_band_calibration_raw(integer, integer, numeric, integer, date, date);

-- 1a. Mutes survive the refit.
create or replace function public.refresh_edge_calibration()
returns void
language plpgsql
security definer
as $function$
BEGIN
  WITH settled AS (
    SELECT
      sport,
      CASE bet_type
        WHEN 'Moneyline' THEN 'ml'
        WHEN 'Spread'    THEN 'spread'
        WHEN 'Total'     THEN 'total'
      END AS market,
      edge_pp_raw / 100.0 AS e,
      (actual_outcome = 'won')::int AS w,
      COALESCE(
        implied_prob,
        CASE WHEN odds ~ '^[+-]?\d+$' THEN
          (CASE WHEN replace(odds,'+','')::numeric > 0
                THEN 100.0 / (replace(odds,'+','')::numeric + 100.0)
                ELSE abs(replace(odds,'+','')::numeric) / (abs(replace(odds,'+','')::numeric) + 100.0)
           END) / 1.02
        END,
        0.5
      ) AS i
    FROM public.ai_suggestions
    WHERE actual_outcome IN ('won','lost')
      AND pipeline_version >= 6
      AND edge_pp_raw IS NOT NULL
      AND edge_pp_raw <> 0
      AND game_date >= now() - interval '120 days'
      AND (game_date AT TIME ZONE 'America/Denver')::date >= DATE '2026-08-17'
      AND bet_type IN ('Moneyline','Spread','Total')
  ),
  by_market AS (
    SELECT sport || ':' || market AS key,
      count(*) AS n,
      sum(e * (w - i)) / nullif(sum(e * e), 0) AS k
    FROM settled
    GROUP BY sport, market
    HAVING count(*) >= 80
  ),
  by_sport AS (
    SELECT sport AS key,
      count(*) AS n,
      sum(e * (w - i)) / nullif(sum(e * e), 0) AS k
    FROM settled
    GROUP BY sport
    HAVING count(*) >= 150
  ),
  global_row AS (
    SELECT '__global__' AS key,
      count(*) AS n,
      sum(e * (w - i)) / nullif(sum(e * e), 0) AS k
    FROM settled
    HAVING count(*) >= 300
  ),
  all_rows AS (
    SELECT * FROM by_market
    UNION ALL SELECT * FROM by_sport
    UNION ALL SELECT * FROM global_row
  )
  INSERT INTO public.edge_calibration (key, multiplier, sample_n, measured_k, source, updated_at)
  SELECT key,
    greatest(0.25, least(1.2, k)),
    n,
    round(k::numeric, 3),
    'weekly-refresh',
    now()
  FROM all_rows
  WHERE k IS NOT NULL
  ON CONFLICT (key) DO UPDATE SET
    multiplier = EXCLUDED.multiplier,
    sample_n   = EXCLUDED.sample_n,
    measured_k = EXCLUDED.measured_k,
    source     = EXCLUDED.source,
    updated_at = EXCLUDED.updated_at
  -- A muted key (multiplier 0, directive 10) is never refit: the 0.25
  -- floor lifted the MLB:total mute on 2026-09-14 with no weight change
  -- row. Re-entry is promote_ready_markets() or the owner, never this.
  WHERE public.edge_calibration.source NOT LIKE '%suspended%'
    AND public.edge_calibration.multiplier <> 0;

  BEGIN
    INSERT INTO public.cron_job_logs (job_name, status, details)
    VALUES ('refresh_edge_calibration', 'success',
            jsonb_build_object('ran_at', now()));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$function$;

-- 1b. Restore the mute, record it, void the rows it leaked.
update edge_calibration set multiplier = 0, source = 'SHADOW 2026-09-11 (owner: closing line 10000 pct, directive 10): MLB totals closed 3.7pp against us on 128 published picks; re-entry when the shadow ledger shows positive price CLV on 100 or more reads (promote_ready_markets). RESTORED 2026-09-14 after the weekly refit floor lifted it at 00:30 with no weight change row.', updated_at = now()
where key = 'MLB:total';

insert into model_weight_changes (sport, component, before, after, reason, source)
values ('MLB', 'MLB:total multiplier',
  '{"multiplier": 0.25, "source": "weekly-refresh 2026-09-14 00:30, no weight change row"}',
  '{"multiplier": 0, "status": "shadow"}',
  'Restoring the directive 10 mute (model_weight_changes 17). The weekly refit floors every key at 0.25 and overwrote the mute; the shadow ledger fails MLB totals on every leg of the directive 20 bar (557 publishable reads, 50.6 actual vs 52.4 implied, -18.58u, CLV -3.20pp, 43.5 pct beat close). The refit now skips muted keys. Ten pending MLB total rows published against the mute on 2026-09-13 and 2026-09-14 are voided.',
  'directive-10-restore');

update ai_suggestions set voided_at = now(),
  voided_reason = 'published against the directive 10 MLB totals mute: the weekly refit floor lifted the mute at 2026-09-14 00:30 with no weight change row; mute restored 2026-09-14'
where sport = 'MLB' and bet_type ilike '%total%' and actual_outcome = 'pending' and voided_at is null
  and created_at >= '2026-09-13 15:00:00-06' and tier in ('Sharp Take','Strong Play','Play','Lean');

insert into cron_job_logs (job_name, status, details)
values ('mute-restore', 'completed', jsonb_build_object('key', 'MLB:total', 'restored_to', 0, 'voided_pending_totals', (select count(*) from ai_suggestions where voided_reason like 'published against the directive 10 MLB totals mute%'), 'at', now())::text);

-- 1c. Directive 21 names the restore source; directive 20 note.
update directives set
  check_sql = 'select id, sport, component, changed_at, source from model_weight_changes where changed_at >= ''2026-09-14 00:00:00-06'' and changed_at < ''2026-09-28 00:00:00-06'' and coalesce(source, '''') not in (''sunday-sweep-approved'', ''promote_ready_markets'', ''weekly-refresh'', ''directive-10-restore'')',
  notes = coalesce(notes, '') || ' 2026-09-14: directive-10-restore added to the allowed sources, restoring a recorded mute is enforcement, not a weight change.',
  updated_at = now()
where id = 21;

-- 4. A recorded mute the live multiplier no longer honors is drift.
create or replace function public.doc_drift_findings()
returns table (drift text, subject text, detail text)
language plpgsql stable
as $$
declare
  d record;
begin
  for d in
    select distinct s.dial from sport_dials s
     where not exists (select 1 from skills k where k.content ilike '%' || s.dial || '%')
     order by s.dial
  loop
    drift := 'dial_undocumented'; subject := d.dial;
    detail := format('sport_dials carries %s and no skill in the skills table names it; add it to the performance review dial list', d.dial);
    return next;
  end loop;

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

  for d in select dv.id, dv.check_sql from directives dv where dv.status = 'active' and dv.check_sql is not null loop
    begin
      execute 'select 1 from (' || d.check_sql || ') q limit 0';
    exception when others then
      drift := 'broken_check_sql'; subject := 'directive ' || d.id;
      detail := left(sqlerrm, 200);
      return next;
    end;
  end loop;

  -- A mute recorded as the LATEST weight change for a key, while the
  -- live multiplier is not 0 (the weekly refit floor lifted MLB:total
  -- on 2026-09-14 with no row). The component of a multiplier change
  -- starts with the edge_calibration key.
  for d in
    select e.key, e.multiplier, e.source, e.updated_at,
           (select m.after from model_weight_changes m where m.component ilike e.key || ' %' or m.component ilike e.key || '%' order by m.changed_at desc limit 1) as latest_after
      from edge_calibration e
     where e.multiplier <> 0
  loop
    if d.latest_after is not null and coalesce((d.latest_after->>'multiplier')::numeric, 1) = 0 then
      drift := 'mute_lifted'; subject := d.key;
      detail := format('latest weight change for %s records multiplier 0 but edge_calibration reads %s (source %s, %s); restore the mute and find what lifted it', d.key, d.multiplier, left(d.source, 40), d.updated_at);
      return next;
    end if;
  end loop;
  return;
end;
$$;

-- 3. The Sunday filer: a real rescue test, the current dial and the capped step.
create or replace function public.file_replay_candidates(p_run_id text, p_variants jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_sport text;
  base record;
  v record;
  t1 record;
  t3 record;
  v_passes boolean;
  v_title text;
  v_detail text;
  v_dials jsonb;
  v_dial_text text;
  kv record;
  cur numeric;
  capped numeric;
  filed int := 0;
  considered int := 0;
begin
  select sport into v_sport from replay_picks where run_id = p_run_id limit 1;
  if v_sport is null then
    return jsonb_build_object('run_id', p_run_id, 'error', 'no picks for run');
  end if;

  select count(*) filter (where outcome = 'won') as won,
         count(*) filter (where outcome = 'lost') as lost,
         coalesce(sum(units), 0) as units, count(*) as picks
    into base
    from replay_picks where run_id = p_run_id and formula = 'base';
  if base.picks = 0 then
    return jsonb_build_object('run_id', p_run_id, 'error', 'no base formula in run');
  end if;

  for v in
    select formula,
           count(*) filter (where outcome = 'won') as won,
           count(*) filter (where outcome = 'lost') as lost,
           coalesce(sum(units), 0) as units, count(*) as picks
      from replay_picks where run_id = p_run_id and formula <> 'base'
     group by formula
  loop
    considered := considered + 1;

    -- Test 1: the games base LOST, scored under the variant. A rescue
    -- means the variant turns at least ten percent of them into wins or
    -- stays out of them; picking the same losing side is not a rescue.
    select count(*) filter (where x.outcome = 'won') as won,
           count(*) filter (where x.outcome = 'lost') as lost,
           coalesce(sum(x.units), 0) as units, count(*) as n,
           count(*) filter (where x.game_key is null) as avoided
      into t1
      from replay_picks b
      left join replay_picks x on x.run_id = b.run_id and x.game_key = b.game_key and x.formula = v.formula
     where b.run_id = p_run_id and b.formula = 'base' and b.outcome = 'lost';

    -- Test 3: publications the variant ADDS that base never made.
    select count(*) filter (where x.outcome = 'won') as won,
           count(*) filter (where x.outcome = 'lost') as lost,
           coalesce(sum(x.units), 0) as units, count(*) as n
      into t3
      from replay_picks x
     where x.run_id = p_run_id and x.formula = v.formula
       and not exists (select 1 from replay_picks b where b.run_id = p_run_id and b.formula = 'base' and b.game_key = x.game_key);

    v_passes := (v.units - base.units >= 2)
      and (coalesce(v.won::numeric / nullif(v.won + v.lost, 0), 0) >= coalesce(base.won::numeric / nullif(base.won + base.lost, 0), 0))
      and (t1.n = 0 or (t1.won + t1.avoided) >= ceil(0.10 * t1.n))
      and (t3.n = 0 or t3.units >= 0);

    select coalesce((select e->'dials' from jsonb_array_elements(coalesce(p_variants, '[]'::jsonb)) e where e->>'name' = v.formula limit 1), '{}'::jsonb)
      into v_dials;

    -- Current value and the directive 8 capped first step per dial.
    v_dial_text := '';
    for kv in select key, value from jsonb_each_text(v_dials) loop
      select value into cur from sport_dials where sport = v_sport and dial = kv.key;
      if cur is null then select value into cur from sport_dials where sport = '__all__' and dial = kv.key; end if;
      if cur is not null and cur <> 0 and abs(kv.value::numeric - cur) > 0.25 * abs(cur) then
        capped := cur + sign(kv.value::numeric - cur) * 0.25 * abs(cur);
        v_dial_text := v_dial_text || format('%s: variant %s, current %s, directive 8 capped first step %s (full move needs a second Sunday); ', kv.key, kv.value, cur, round(capped, 4));
      else
        v_dial_text := v_dial_text || format('%s: variant %s, current %s; ', kv.key, kv.value, coalesce(cur::text, 'code default'));
      end if;
    end loop;
    if v_dial_text = '' then v_dial_text := 'no dial payload (variant name only)'; end if;

    v_detail := format(
      'Sunday sweep %s (%s): variant %s against base. TEST 2 whole record: %s-%s %su vs base %s-%s %su (delta %su). TEST 1 rescue of the %s games base lost: variant won %s, stayed out of %s, lost %s (%su); needs 10 percent turned. TEST 3 publications the variant adds: %s-%s %su on %s. DIALS: %s. %s Apply through sport_dials plus a model_weight_changes row with source sunday-sweep-approved.',
      p_run_id, v_sport, v.formula,
      v.won, v.lost, round(v.units, 1), base.won, base.lost, round(base.units, 1), round(v.units - base.units, 1),
      t1.n, t1.won, t1.avoided, t1.lost, round(t1.units, 1),
      t3.won, t3.lost, round(t3.units, 1), t3.n,
      v_dial_text,
      case when v_passes then 'PASSES all three tests.' else 'Does not pass.' end);

    if v_passes then
      v_title := format('Sunday sweep candidate (%s): %s beats base by %su, run %s', v_sport, v.formula, round(v.units - base.units, 1), p_run_id);
      if not exists (select 1 from build_queue bq where bq.title = v_title) then
        insert into build_queue (title, detail, status, priority) values (v_title, v_detail, 'open', 'high');
        filed := filed + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('run_id', p_run_id, 'sport', v_sport, 'variants_considered', considered, 'filed', filed,
    'base', jsonb_build_object('won', base.won, 'lost', base.lost, 'units', round(base.units, 1)));
end;
$$;

update build_queue set status = 'dismissed', updated_at = now(),
  detail = detail || ' DISMISSED 2026-09-14 by the calibration review: test 1 was 5 of 167 base losers turned (not a rescue), the dial payload was empty, and 0.5 to 0.25 is a 50 percent cut against the directive 8 cap. The filer now requires ten percent of base losers turned, carries the dial payload, and states the capped first step. Re-tested next Sunday.'
where id = 34;

-- 2b. Run the band refit the cron could not.
select public.refresh_edge_band_calibration_raw(p_fit_floor := '2026-09-12'::date);
