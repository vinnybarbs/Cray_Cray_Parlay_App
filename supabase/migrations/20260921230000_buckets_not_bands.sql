-- Owner 2026-09-21: buckets, not bands.
--
-- "A pick dropping to a lower label should be because we learned some
-- weighted value puts it there. The bands are buckets that these picks
-- fall into. Define target win percentages for each bucket and tune
-- toward that goal." And on the weekly band refit: "we keep just moving
-- the goal posts to try and get a ball through, not a real fix."
--
-- What this does:
--   1. Retires every scheduled calibration refit (both band maps and
--      the flat multiplier) and pins every band map to identity. The
--      tier is the raw claim times the sport multiplier dial minus the
--      price rails, nothing else. Multipliers are dials from here on,
--      moved only through the three test sweep.
--   2. MLB multipliers go to 1. Since 2026-08-31 the MLB raw band map
--      replaced the flat k for sizing, so identity map plus k 1 is the
--      same sizing MLB has been publishing under: the tier is the raw
--      claim. NFL, Tennis and UFC keep their multiplier dials (NFL's is
--      the 09-28 counterfactual, build_queue 44).
--   3. bucket_targets: the floor each bucket must deliver, in pp over
--      break even at the price (Lean 2, Play 4, Strong Play 7, Sharp
--      Take 10, per sport override allowed).
--   4. bucket_scorecard(): delivered pp per sport per bucket against the
--      floor, on the public record's population. file_bucket_scorecard()
--      files it to agent_reports every Monday before the review.
--   5. file_replay_candidates(): every Sunday sweep variant now reports
--      its buckets against the floors next to the three tests, and a
--      candidate names the bucket it fixes.
--   6. Directive 25, amendments to 9 and 21, build_queue rows.

-- 1. Retire the refits.
do $$
declare j text;
begin
  for j in select jobname from cron.job
            where jobname in ('edge-band-calibration-weekly', 'edge-band-calibration-raw-weekly', 'edge_calibration_weekly')
  loop
    perform cron.unschedule(j);
  end loop;
end $$;

update public.edge_band_calibration_raw
   set calibrated_center = claimed_center, target_center = claimed_center, fitted_at = now();
update public.edge_band_calibration
   set calibrated_center = claimed_center, fitted_at = now();

-- 2. MLB multipliers to 1 (sizing unchanged: the raw map was already the
--    only thing sizing MLB). MLB:total stays at 0, the directive 10 mute.
update public.edge_calibration
   set multiplier = 1.0,
       source = 'owner-approved-2026-09-21 buckets not bands: the raw band map replaced k for MLB sizing since 08-31, identity map plus k 1 keeps the tier equal to the raw claim minus rails',
       updated_at = now()
 where key in ('MLB', 'MLB:ml', 'MLB:spread');

insert into public.model_weight_changes (sport, component, before, after, reason, source) values
  ('__all__', 'band map retired: identity for every sport and market, weekly band and multiplier refits unscheduled',
   jsonb_build_object('edge_band_calibration_raw', 'refit Mondays 06:40 UTC, MLB 4-7 center 9.25 and 7-10 center 11.24 after the 09-21 refit on 52 and 16 rows',
                      'edge_band_calibration', 'refit Mondays 06:35 UTC', 'edge_calibration', 'refit Mondays 06:30 UTC, 0.25 floor'),
   jsonb_build_object('edge_band_calibration_raw', 'identity, no schedule', 'edge_band_calibration', 'identity, no schedule',
                      'edge_calibration', 'dials, no schedule, moved only through the three test sweep', 'tier', 'raw claim times sport multiplier dial minus price rails'),
   'Owner 2026-09-21: the band refit relabels picks and never changes which side we take or which picks publish, so it moves the goal posts and wins nothing. The tier is the scored claim, the bands are buckets with floors (bucket_targets), and a bucket under its floor is fixed by turning a factor weight through the three tests. Directive 25.',
   'owner-approved-2026-09-21'),
  ('MLB', 'MLB, MLB:ml, MLB:spread multiplier 0.25 to 1 (MLB:total stays 0)',
   jsonb_build_object('multiplier', 0.25, 'note', 'bypassed for sizing since 2026-08-31 by the MLB raw band map'),
   jsonb_build_object('multiplier', 1, 'note', 'identity band map plus k 1 is the same sizing: tier equals the raw claim minus rails'),
   'Owner 2026-09-21 buckets not bands. Keeps MLB sizing where the raw map had it while the map goes to identity; the multiplier is a dial now and moves only through the sweep.',
   'owner-approved-2026-09-21');

-- 3. Bucket floors.
create table if not exists public.bucket_targets (
  sport text not null,
  band text not null,
  floor_pp numeric not null,
  updated_at timestamptz not null default now(),
  primary key (sport, band)
);
alter table public.bucket_targets enable row level security;
drop policy if exists bucket_targets_read on public.bucket_targets;
create policy bucket_targets_read on public.bucket_targets for select using (true);
grant select on public.bucket_targets to anon, authenticated, service_role;

insert into public.bucket_targets (sport, band, floor_pp) values
  ('__all__', 'Lean', 2), ('__all__', 'Play', 4), ('__all__', 'Strong Play', 7), ('__all__', 'Sharp Take', 10)
on conflict (sport, band) do nothing;

-- 4. The scorecard. Population mirrors mv_public_record's base: the
--    published pick domains, deduped per game and market, voided rows
--    out, soccer v1 out, settled won or lost with a parseable price.
--    band_fit_floors is honored per sport so a regime restart never
--    grades the new model by the old model's picks (directive 9).
create or replace function public.bucket_scorecard(p_days integer default 30, p_min_n integer default 50, p_regime_floor date default null)
returns table (
  sport text, band text, floor_pp numeric, n bigint, won bigint, lost bigint,
  win_pct numeric, breakeven_pct numeric, delivered_pp numeric, gap_pp numeric, status text
)
language sql stable
as $$
  with base as (
    select distinct on (s.home_team, s.away_team, s.game_date, s.bet_type)
           s.sport, s.tier, s.actual_outcome,
           case when s.odds::text ~ '^[+-]?\d+$' then
             case when s.odds::integer > 0 then 100.0 / (s.odds::integer + 100.0)
                  when s.odds::integer < 0 then abs(s.odds::integer) / (abs(s.odds::integer) + 100.0) end
           end as breakeven
      from ai_suggestions s
     where s.session_id::text like 'auto_digest%'
       and s.tier in ('Sharp Take', 'Strong Play', 'Play', 'Lean')
       and s.voided_at is null
       and s.sport::text not in ('EPL', 'MLS', 'Soccer', 'World Cup', 'Champions League', 'Copa America', 'Euros')
       and (s.game_date at time zone 'America/Denver')::date >= (now() at time zone 'America/Denver')::date - (p_days - 1)
       and (s.game_date at time zone 'America/Denver')::date >= coalesce(p_regime_floor, '2000-01-01'::date)
       and (s.game_date at time zone 'America/Denver')::date >= coalesce((select f.fit_floor from band_fit_floors f where f.sport = s.sport::text), '2000-01-01'::date)
     order by s.home_team, s.away_team, s.game_date, s.bet_type, (s.actual_outcome::text = 'pending'), coalesce(s.last_revised_at, s.created_at) desc
  ),
  settled as (
    select sport::text as sport, tier::text as band, actual_outcome::text as outcome, breakeven
      from base where actual_outcome::text in ('won', 'lost') and breakeven is not null
  ),
  scoped as (
    select sport, band, outcome, breakeven from settled
    union all
    select '__all__', band, outcome, breakeven from settled
  ),
  agg as (
    select sport, band,
           count(*) as n,
           count(*) filter (where outcome = 'won') as won,
           count(*) filter (where outcome = 'lost') as lost,
           avg(breakeven) as be
      from scoped group by sport, band
  )
  select a.sport, a.band,
         coalesce(t.floor_pp, d.floor_pp) as floor_pp,
         a.n, a.won, a.lost,
         round(100.0 * a.won / nullif(a.won + a.lost, 0), 1) as win_pct,
         round(100.0 * a.be, 1) as breakeven_pct,
         round(100.0 * a.won / nullif(a.won + a.lost, 0) - 100.0 * a.be, 1) as delivered_pp,
         round(100.0 * a.won / nullif(a.won + a.lost, 0) - 100.0 * a.be - coalesce(t.floor_pp, d.floor_pp), 1) as gap_pp,
         case when a.n < p_min_n then 'thin'
              when 100.0 * a.won / nullif(a.won + a.lost, 0) - 100.0 * a.be >= coalesce(t.floor_pp, d.floor_pp) then 'on_target'
              else 'under' end as status
    from agg a
    left join bucket_targets t on t.sport = a.sport and t.band = a.band
    left join bucket_targets d on d.sport = '__all__' and d.band = a.band
   order by a.sport,
            case a.band when 'Sharp Take' then 1 when 'Strong Play' then 2 when 'Play' then 3 else 4 end;
$$;

grant execute on function public.bucket_scorecard(integer, integer, date) to anon, authenticated, service_role;

-- Files the Monday scorecard to the blackboard. Names the sweep target:
-- the bucket furthest under its floor on a real sample, per sport.
create or replace function public.file_bucket_scorecard(p_days integer default 30, p_min_n integer default 50)
returns jsonb
language plpgsql
as $$
declare
  r record;
  v_rows jsonb := '[]'::jsonb;
  v_under jsonb := '[]'::jsonb;
  v_lines text := '';
  v_cur_sport text := '';
  v_target text := null;
  v_target_gap numeric := 0;
  v_id bigint;
begin
  for r in select * from bucket_scorecard(p_days, p_min_n) loop
    v_rows := v_rows || jsonb_build_object('sport', r.sport, 'band', r.band, 'n', r.n, 'won', r.won, 'lost', r.lost,
      'delivered_pp', r.delivered_pp, 'floor_pp', r.floor_pp, 'gap_pp', r.gap_pp, 'status', r.status);
    if r.sport <> v_cur_sport then
      v_lines := v_lines || case when v_cur_sport = '' then '' else ' | ' end || r.sport || ': ';
      v_cur_sport := r.sport;
    else
      v_lines := v_lines || ', ';
    end if;
    v_lines := v_lines || format('%s %s-%s %spp vs floor %s (%s%s)', r.band, r.won, r.lost,
      case when r.delivered_pp >= 0 then '+' else '' end || r.delivered_pp, r.floor_pp,
      case r.status when 'under' then 'UNDER' when 'on_target' then 'ok' else 'thin' end,
      case when r.status = 'thin' then ', n ' || r.n else '' end);
    if r.status = 'under' then
      v_under := v_under || jsonb_build_object('sport', r.sport, 'band', r.band, 'gap_pp', r.gap_pp, 'n', r.n);
      if r.sport <> '__all__' and r.gap_pp < v_target_gap then
        v_target_gap := r.gap_pp; v_target := r.sport || ' ' || r.band;
      end if;
    end if;
  end loop;

  insert into agent_reports (agent, summary, findings)
  values ('bucket-scorecard',
    format('Bucket scorecard, last %s days, floors from bucket_targets (delivered pp over break even at the price, %s rows or more to judge). %s. %s',
      p_days, p_min_n, coalesce(nullif(v_lines, ''), 'no settled picks in the window'),
      case when v_target is null then 'No bucket under its floor on a real sample: the sweep runs its standing variants.'
           else format('Next sweep target: %s, %s pp under its floor. Find the factor family that generates those claims (lookback_reads for football, edge_factors for the rest) and try damping it through the three tests. Never fix a bucket by relabeling (directive 25).', v_target, v_target_gap) end),
    jsonb_build_object('days', p_days, 'min_n', p_min_n, 'rows', v_rows, 'under', v_under, 'sweep_target', v_target, 'sweep_target_gap_pp', v_target_gap))
  returning id into v_id;

  return jsonb_build_object('agent_report_id', v_id, 'under', v_under, 'sweep_target', v_target);
end;
$$;

select cron.unschedule('bucket-scorecard-weekly') where exists (select 1 from cron.job where jobname = 'bucket-scorecard-weekly');
select cron.schedule('bucket-scorecard-weekly', '50 6 * * 1', $$ select public.file_bucket_scorecard(30, 50); $$);

-- 5. The sweep reports buckets next to the three tests.
create or replace function public.replay_buckets(p_run_id text, p_formula text, p_sport text)
returns table (band text, n bigint, won bigint, lost bigint, delivered_pp numeric, floor_pp numeric, gap_pp numeric)
language sql stable
as $$
  with rows_ as (
    select tier as band, outcome,
           case when odds > 0 then 100.0 / (odds + 100.0) else abs(odds) / (abs(odds) + 100.0) end as be
      from replay_picks
     where run_id = p_run_id and formula = p_formula and outcome in ('won', 'lost') and odds is not null
  ),
  agg as (
    select band, count(*) as n, count(*) filter (where outcome = 'won') as won,
           count(*) filter (where outcome = 'lost') as lost, avg(be) as be
      from rows_ group by band
  )
  select a.band, a.n, a.won, a.lost,
         round(100.0 * a.won / nullif(a.won + a.lost, 0) - 100.0 * a.be, 1) as delivered_pp,
         coalesce(t.floor_pp, d.floor_pp) as floor_pp,
         round(100.0 * a.won / nullif(a.won + a.lost, 0) - 100.0 * a.be - coalesce(t.floor_pp, d.floor_pp), 1) as gap_pp
    from agg a
    left join bucket_targets t on t.sport = p_sport and t.band = a.band
    left join bucket_targets d on d.sport = '__all__' and d.band = a.band
   order by case a.band when 'Sharp Take' then 1 when 'Strong Play' then 2 when 'Play' then 3 else 4 end;
$$;

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
  b record;
  bb record;
  v_passes boolean;
  v_title text;
  v_detail text;
  v_dials jsonb;
  v_dial_text text;
  v_bucket_text text;
  v_fixes text;
  v_breaks text;
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

    select count(*) filter (where x.outcome = 'won') as won,
           count(*) filter (where x.outcome = 'lost') as lost,
           coalesce(sum(x.units), 0) as units, count(*) as n,
           count(*) filter (where x.game_key is null) as avoided
      into t1
      from replay_picks b0
      left join replay_picks x on x.run_id = b0.run_id and x.game_key = b0.game_key and x.formula = v.formula
     where b0.run_id = p_run_id and b0.formula = 'base' and b0.outcome = 'lost';

    select count(*) filter (where x.outcome = 'won') as won,
           count(*) filter (where x.outcome = 'lost') as lost,
           coalesce(sum(x.units), 0) as units, count(*) as n
      into t3
      from replay_picks x
     where x.run_id = p_run_id and x.formula = v.formula
       and not exists (select 1 from replay_picks b0 where b0.run_id = p_run_id and b0.formula = 'base' and b0.game_key = x.game_key);

    v_passes := (v.units - base.units >= 2)
      and (coalesce(v.won::numeric / nullif(v.won + v.lost, 0), 0) >= coalesce(base.won::numeric / nullif(base.won + base.lost, 0), 0))
      and (t1.n = 0 or (t1.won + t1.avoided) >= ceil(0.10 * t1.n))
      and (t3.n = 0 or t3.units >= 0);

    -- Buckets (directive 25): delivered pp per tier against the floor,
    -- variant beside base. A variant FIXES a bucket when base sat under
    -- the floor on 20 rows or more and the variant reaches it or closes
    -- the gap by 2pp; it BREAKS one when the reverse happens.
    v_bucket_text := '';
    v_fixes := '';
    v_breaks := '';
    for b in select * from replay_buckets(p_run_id, v.formula, v_sport) loop
      select * into bb from replay_buckets(p_run_id, 'base', v_sport) x where x.band = b.band;
      v_bucket_text := v_bucket_text || format('%s: variant %s-%s %spp vs base %s-%s %spp, floor %s; ',
        b.band, b.won, b.lost, b.delivered_pp, coalesce(bb.won, 0), coalesce(bb.lost, 0), coalesce(bb.delivered_pp::text, 'none'), b.floor_pp);
      if bb.n is not null and bb.n >= 20 and b.n >= 20 and bb.gap_pp < 0
         and (b.gap_pp >= 0 or b.gap_pp - bb.gap_pp >= 2) then
        v_fixes := v_fixes || case when v_fixes = '' then '' else ', ' end || b.band;
      end if;
      if bb.n is not null and bb.n >= 20 and b.n >= 20 and bb.gap_pp >= 0 and b.gap_pp <= -2 then
        v_breaks := v_breaks || case when v_breaks = '' then '' else ', ' end || b.band;
      end if;
    end loop;
    if v_bucket_text = '' then v_bucket_text := 'no settled buckets'; end if;

    select coalesce((select e->'dials' from jsonb_array_elements(coalesce(p_variants, '[]'::jsonb)) e where e->>'name' = v.formula limit 1), '{}'::jsonb)
      into v_dials;

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
      'Sunday sweep %s (%s): variant %s against base. TEST 2 whole record: %s-%s %su vs base %s-%s %su (delta %su). TEST 1 rescue of the %s games base lost: variant won %s, stayed out of %s, lost %s (%su); needs 10 percent turned. TEST 3 publications the variant adds: %s-%s %su on %s. BUCKETS (delivered pp over break even, directive 25): %s%s%s DIALS: %s. %s Apply through sport_dials plus a model_weight_changes row with source sunday-sweep-approved.',
      p_run_id, v_sport, v.formula,
      v.won, v.lost, round(v.units, 1), base.won, base.lost, round(base.units, 1), round(v.units - base.units, 1),
      t1.n, t1.won, t1.avoided, t1.lost, round(t1.units, 1),
      t3.won, t3.lost, round(t3.units, 1), t3.n,
      v_bucket_text,
      case when v_fixes <> '' then format('FIXES %s. ', v_fixes) else '' end,
      case when v_breaks <> '' then format('BREAKS %s. ', v_breaks) else '' end,
      v_dial_text,
      case when v_passes then 'PASSES all three tests.' else 'Does not pass.' end);

    if v_passes then
      v_title := format('Sunday sweep candidate (%s): %s beats base by %su%s, run %s', v_sport, v.formula, round(v.units - base.units, 1),
        case when v_fixes <> '' then ' and fixes the ' || v_fixes || ' bucket' else '' end, p_run_id);
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

-- 6. Directives and the queue.
insert into public.directives (directive, decided_on, status, enforcement, check_sql, notes) values (
  'Buckets, not bands. The tier is the scored claim: the raw edge times the sport multiplier dial minus the price rails, and nothing else. No band map and no scheduled refit of any calibration table; multipliers are dials, moved only through the three test sweep with a model_weight_changes row. Each bucket carries a floor in bucket_targets (Lean 2, Play 4, Strong Play 7, Sharp Take 10 pp delivered over break even at the price). The Monday scorecard (bucket_scorecard, filed by file_bucket_scorecard) names any bucket under its floor on 50 or more rows, and that bucket is the next sweep target: find the factor family generating those claims and turn it through the three tests. A bucket miss is never fixed by relabeling.',
  '2026-09-21', 'active',
  'this check_sql; band-calibration.js is identity; the sweep reports buckets on every candidate',
  $chk$select 'calibration refit still scheduled' as finding, jobname as what from cron.job where jobname in ('edge-band-calibration-weekly', 'edge-band-calibration-raw-weekly', 'edge_calibration_weekly')
union all select 'band map not identity', sport || ':' || market || ':' || band from edge_band_calibration_raw where calibrated_center <> claimed_center
union all select 'legacy band map not identity', sport || ':' || band from edge_band_calibration where calibrated_center <> claimed_center
union all select 'multiplier moved by a refit after 2026-09-21', key from edge_calibration where source = 'weekly-refresh' and updated_at > '2026-09-21 12:00:00-06'
union all select 'bucket floors missing', band from (values ('Lean'), ('Play'), ('Strong Play'), ('Sharp Take')) v(band) where not exists (select 1 from bucket_targets t where t.sport = '__all__' and t.band = v.band)$chk$,
  'Owner 2026-09-21: "a pick dropping to a lower label should be because we learned some weighted value puts it there. The bands are buckets that these picks fall into. Define target win percentages for each bucket and tune toward that goal." Replaces the band refit (retired the same day after the 09-21 refit doubled the MLB 4-7 center off nine days). The 30 day scorecard at the decision: Sharp Take -10.2pp on 36, Strong Play +2.9 on 66, Play +7.7 on 161, Lean +8.6 on 308.'
);

update public.directives
   set directive = directive || ' Amended 2026-09-21 (directive 25): the band maps are identity and never refit, so a regime change resets nothing; instead advance the sport''s band_fit_floors row, which the bucket scorecard honors, so the scorecard never grades the new model by the old model''s picks.',
       updated_at = now()
 where id = 9;

update public.directives
   set directive = directive || ' Amended 2026-09-21 (owner, buckets not bands): the scheduled weekly refits in (c) are retired (band maps identity, multipliers are dials) and the two rows that did it carry source owner-approved-2026-09-21. The freeze on factor weights otherwise stands through 2026-09-27.',
       check_sql = replace(check_sql, '''owner-approved-2026-09-15'')', '''owner-approved-2026-09-15'', ''owner-approved-2026-09-21'')'),
       updated_at = now()
 where id = 21;

update public.build_queue
   set status = 'dismissed',
       detail = detail || ' DISMISSED 2026-09-21: superseded by directive 25. The owner retired the band refit outright instead of capping it: the map relabels picks and wins nothing.'
 where id = 49;

insert into public.build_queue (priority, status, title, detail) values
  ('high', 'done', 'Buckets not bands: band refits retired, identity maps, bucket floors, Monday scorecard, sweep buckets (owner 2026-09-21)',
   'Directive 25. Unscheduled edge-band-calibration-weekly, edge-band-calibration-raw-weekly and edge_calibration_weekly; both band tables pinned to identity; lib/services/band-calibration.js is identity in code. MLB, MLB:ml and MLB:spread multipliers 0.25 to 1 (the raw map had bypassed k since 08-31, so sizing is unchanged: tier equals the raw claim minus rails). bucket_targets seeded Lean 2, Play 4, Strong Play 7, Sharp Take 10. bucket_scorecard(p_days, p_min_n, p_regime_floor) and file_bucket_scorecard() on cron bucket-scorecard-weekly (Mondays 06:50 UTC, before the review), filing agent bucket-scorecard rows that name the next sweep target. file_replay_candidates reports every variant''s buckets against the floors and a candidate title names the bucket it fixes. Dial board shows the floors in place of the band map. Open question for the owner: gate candidate 47 (min_gate_pp) still on hold.');
