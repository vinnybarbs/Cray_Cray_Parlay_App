-- The five moves (owner, 2026-09-13: "let's do all of them").
--
-- 1. MLB run line home skew: home_margin_shift dial (code default 0; the
--    MLB value lands after the replay sweep, with its own
--    model_weight_changes row).
-- 2. Tennis fence from +251 to +111 (directive 4 amended).
-- 3. The Sunday sweep: a weekly replay of every dial variant, scored
--    against base with the three test counterfactual in SQL, filed in
--    build_queue for the owner's Monday yes or no.
-- 4. Shadow to live per MARKET: publish_ml, publish_spread, publish_total
--    dials replace the SHADOW_SPORTS code constant, and
--    promote_ready_markets() flips a market live the morning it clears
--    the shadow ledger bar (directive 20).
-- 5. The dial freeze: directive 21, no weight change outside the Sunday
--    sweep or the promotion rule until 2026-09-27.

-- 4a. Publication dials. Shadow sports start closed on every market.
insert into sport_dials (sport, dial, value)
select s.sport, d.dial, 0
from unnest(array['NCAAF','EPL','MLS','Soccer','World Cup','Champions League','Copa America','Euros']) as s(sport)
cross join unnest(array['publish_ml','publish_spread','publish_total']) as d(dial)
on conflict (sport, dial) do nothing;

insert into sport_dials (sport, dial, value)
values ('__all__', 'publish_ml', 1), ('__all__', 'publish_spread', 1), ('__all__', 'publish_total', 1)
on conflict (sport, dial) do nothing;

insert into model_weight_changes (sport, component, before, after, reason, source)
values ('__all__', 'publish_ml, publish_spread, publish_total (new dials)',
  '{"gate": "SHADOW_SPORTS code constant, whole sport"}',
  '{"gate": "three dials per sport on the board, shadow sports 0 on every market, everyone else 1"}',
  'Owner 2026-09-13, move 4: the shadow ledger judges markets, not sports (NCAAF moneylines 23-12 beating the close 71 pct while NCAAF spreads close -1.67pp), so publication is decided per market and promote_ready_markets() can open one market at a time. Live behavior is unchanged today.',
  'claude-code');

-- 2. Directive 4 amended: the fence moves to +111.
update directives set
  directive = 'Tennis at +111 or longer never publishes (dispersion mirage, not prediction). Pending rows past the fence are voided, not demoted. Fence was +251 from 2026-09-01 to 2026-09-13.',
  enforcement = 'pre-analyze-games TENNIS_LONGSHOT_FENCE (111); voidFencedTennisRow',
  check_sql = 'select id, tier, odds from ai_suggestions where voided_at is null and sport = ''Tennis'' and created_at > now() - interval ''2 days'' and odds ~ ''^[+-]?[0-9]+$'' and odds::numeric >= 111 and tier not in (''Trap'',''Skip'')',
  notes = coalesce(notes, '') || ' 2026-09-13 owner: fence lowered to +111. 30 day published Tennis: favorites 27-8 +5.2u, dogs +111 or longer 12-33 -10.4u (26.7 pct at prices needing about 40), positive closing line value on both, so the dog band inside the old fence was the whole Tennis loss.',
  updated_at = now()
where id = 4;

-- 3. The Sunday sweep filer: every variant against base, three tests.
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
  v_dials text;
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

    -- Test 1: the games base LOST, scored under the variant.
    select count(*) filter (where x.outcome = 'won') as won,
           count(*) filter (where x.outcome = 'lost') as lost,
           coalesce(sum(x.units), 0) as units, count(*) as n
      into t1
      from replay_picks b
      join replay_picks x on x.run_id = b.run_id and x.game_key = b.game_key and x.formula = v.formula
     where b.run_id = p_run_id and b.formula = 'base' and b.outcome = 'lost';

    -- Test 3: publications the variant ADDS that base never made.
    select count(*) filter (where x.outcome = 'won') as won,
           count(*) filter (where x.outcome = 'lost') as lost,
           coalesce(sum(x.units), 0) as units, count(*) as n
      into t3
      from replay_picks x
     where x.run_id = p_run_id and x.formula = v.formula
       and not exists (select 1 from replay_picks b where b.run_id = p_run_id and b.formula = 'base' and b.game_key = x.game_key);

    -- Test 2 is the whole record: at least 2 units better AND no worse a win rate.
    v_passes := (v.units - base.units >= 2)
      and (coalesce(v.won::numeric / nullif(v.won + v.lost, 0), 0) >= coalesce(base.won::numeric / nullif(base.won + base.lost, 0), 0))
      and (t1.n = 0 or t1.units > -t1.n)
      and (t3.n = 0 or t3.units >= 0);

    select coalesce((select (e->'dials')::text from jsonb_array_elements(coalesce(p_variants, '[]'::jsonb)) e where e->>'name' = v.formula limit 1), '{}')
      into v_dials;

    v_detail := format(
      'Sunday sweep %s (%s): variant %s against base. TEST 2 whole record: %s-%s %su vs base %s-%s %su (delta %su). TEST 1 base losers under the variant: %s-%s %su on %s games base lost. TEST 3 publications the variant adds: %s-%s %su on %s. Dials: %s. %s Apply through sport_dials plus a model_weight_changes row with source sunday-sweep-approved, at most 25 percent of the current weight per step unless a second Sunday repeats the reading.',
      p_run_id, v_sport, v.formula,
      v.won, v.lost, round(v.units, 1), base.won, base.lost, round(base.units, 1), round(v.units - base.units, 1),
      t1.won, t1.lost, round(t1.units, 1), t1.n,
      t3.won, t3.lost, round(t3.units, 1), t3.n,
      v_dials,
      case when v_passes then 'PASSES all three tests.' else 'Does not pass; filed for the record only when it beats base.' end);

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

comment on function public.file_replay_candidates(text, jsonb) is
  'Sunday sweep: scores every replay variant against base with the three test counterfactual (base losers rescued, whole record better by 2u with no worse win rate, added publications not losers) and files passing variants in build_queue for the owner. Called by /cron/replay-formula?file=1.';

-- 4b. Automatic promotion the morning a market clears the bar.
create or replace function public.promote_ready_markets()
returns jsonb
language plpgsql
as $$
declare
  r record;
  m text;
  k text;
  prev numeric;
  promoted jsonb := '[]'::jsonb;
begin
  for r in
    select rr.* from public.shadow_market_readiness() rr
     where rr.ready
       and (rr.sport in ('NCAAF','EPL','MLS','Soccer','World Cup','Champions League','Copa America','Euros')
            or exists (select 1 from edge_calibration e
                        where e.key = rr.sport || ':' || case rr.market when 'h2h' then 'ml' when 'spreads' then 'spread' else 'total' end
                          and e.multiplier = 0))
  loop
    m := case r.market when 'h2h' then 'ml' when 'spreads' then 'spread' else 'total' end;
    k := r.sport || ':' || m;
    -- Already publishing and not muted: nothing to do.
    if exists (select 1 from sport_dials d where d.sport = r.sport and d.dial = 'publish_' || m and d.value >= 1)
       and not exists (select 1 from edge_calibration e where e.key = k and e.multiplier = 0) then
      continue;
    end if;
    select multiplier into prev from edge_calibration where key = k;

    insert into sport_dials (sport, dial, value) values (r.sport, 'publish_' || m, 1)
      on conflict (sport, dial) do update set value = 1;

    insert into edge_calibration (key, multiplier, sample_n, measured_k, source, updated_at)
      values (k, 0.25, r.publishable, null,
        format('go-live %s via promote_ready_markets: shadow ledger %s-%s on %s publishable, %s actual vs %s implied, %su, CLV %spp (%s pct beat close). Damped seed 0.25, weekly refit takes over. Directive 20.',
          current_date, r.wins, r.losses, r.publishable, r.actual_pct, r.implied_pct, r.units, r.avg_clv_pp, r.pct_beat_close),
        now())
      on conflict (key) do update set multiplier = 0.25, sample_n = excluded.sample_n, source = excluded.source, updated_at = now();

    insert into model_weight_changes (sport, component, before, after, reason, source)
      values (r.sport, k || ' go-live',
        jsonb_build_object('publish', 0, 'multiplier', prev),
        jsonb_build_object('publish', 1, 'multiplier', 0.25),
        format('Automatic promotion (directive 20 rule, owner 2026-09-13): %s-%s on %s publishable shadow reads, %s actual vs %s implied, %su, closing line value %spp, %s pct beat close.',
          r.wins, r.losses, r.publishable, r.actual_pct, r.implied_pct, r.units, r.avg_clv_pp, r.pct_beat_close),
        'promote_ready_markets');

    insert into agent_reports (agent, summary, findings)
      values ('promote-ready-markets',
        format('%s went LIVE automatically at multiplier 0.25: shadow ledger %s-%s on %s publishable reads, %s actual vs %s implied, %su, CLV %spp (%s pct beat close). Directive 20 rule. The owner reverses by setting sport_dials publish_%s to 0 for %s.',
          k, r.wins, r.losses, r.publishable, r.actual_pct, r.implied_pct, r.units, r.avg_clv_pp, r.pct_beat_close, m, r.sport),
        jsonb_build_object('key', k, 'publishable', r.publishable, 'units', r.units, 'avg_clv_pp', r.avg_clv_pp, 'pct_beat_close', r.pct_beat_close));

    promoted := promoted || jsonb_build_object('key', k, 'publishable', r.publishable);
  end loop;
  return jsonb_build_object('promoted', promoted, 'at', now());
end;
$$;

comment on function public.promote_ready_markets() is
  'Directive 20 rule (owner 2026-09-13): a shadow sport market or muted market that clears the shadow ledger bar opens (publish dial 1) at a damped 0.25 multiplier, with model_weight_changes and a blackboard row. Runs daily from pg_cron.';

-- 5. Directive 21: the dial freeze.
insert into directives (directive, decided_on, enforcement, check_sql, notes, status)
values (
  'Dial freeze through 2026-09-27: no model weight, dial, multiplier or band map change outside (a) a Sunday sweep candidate the owner approved (source sunday-sweep-approved), (b) the automatic promotion rule (source promote_ready_markets), or (c) the scheduled weekly refits (source weekly-refresh). The formula changed three times on 2026-09-12 and the calibration regime restarted; 150 live picks settle before anyone touches a weight again.',
  '2026-09-13',
  'this check_sql against model_weight_changes; the Sunday sweep files candidates, it never applies them',
  'select id, sport, component, changed_at, source from model_weight_changes where changed_at >= ''2026-09-14 00:00:00-06'' and changed_at < ''2026-09-28 00:00:00-06'' and coalesce(source, '''') not in (''sunday-sweep-approved'', ''promote_ready_markets'', ''weekly-refresh'')',
  'Owner 2026-09-13, move 5: "leave the dials alone for two weeks". Any row this check returns is a freeze violation and a finding.',
  'active'
);

-- 3b, 4c. The routines. Secrets stay in cron.job, never in this file.
select cron.unschedule(jobid) from cron.job where jobname in ('weekly-replay-sweep', 'promote-ready-markets');

select cron.schedule(
  'weekly-replay-sweep',
  '0 5 * * 1',
  format($cmd$
  SELECT net.http_post(
    url := 'https://craycrayparlayapp-production.up.railway.app/cron/replay-formula?secret=%s&sport=MLB&days=30&file=1&variants=base:current%%3Bgate3:current:min_gate_pp=3%%3Bvenue_lo:current:venue_weight=0.15%%3Bvenue_hi:current:venue_weight=0.5%%3Bsos0:current:sos_sensitivity=0%%3Bspread25:current:spread_claim_damp=0.25%%3Bspread75:current:spread_claim_damp=0.75%%3Bshift0:current:home_margin_shift=0%%3Bshift_hi:current:home_margin_shift=-0.75&run_id=weekly_sweep_mlb_' || to_char(now() at time zone 'America/Denver', 'YYYYMMDD'),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 300000
  ) as request_id;
  $cmd$, (select substring(command from 'secret=([^&]+)') from cron.job where jobname = 'pre-analyze-mlb'))
);

select cron.schedule('promote-ready-markets', '0 13 * * *', $$ select public.promote_ready_markets(); $$);
