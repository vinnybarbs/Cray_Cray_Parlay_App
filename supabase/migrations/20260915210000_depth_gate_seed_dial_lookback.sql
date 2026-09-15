-- Owner 2026-09-15, "yes to all" on: the depth chart gate for the NFL
-- injury factor, the playoff seed prior off for football, retiring the
-- LLM postmortem nobody reads, and build_queue 40 (the weekly football
-- lookback). Every formula change here is an owner approved exception
-- to directive 21, recorded in model_weight_changes with source
-- owner-approved-2026-09-15 and named in the amended directive.

-- ---------------------------------------------------------------------
-- 1. Depth chart history: a rolling 28 day window per club instead of
--    the newest snapshot only. Clubs demote an injured starter the day
--    he is hurt (Josh Jacobs rank 1 through the summer, rank 4 from
--    2026-09-06), so the gate reads each player's BEST rank over the
--    window, not the newest chart.
-- ---------------------------------------------------------------------
ALTER TABLE public.nfl_depth_charts
  DROP CONSTRAINT IF EXISTS nfl_depth_charts_team_pos_grp_pos_abb_pos_slot_pos_rank_key;
ALTER TABLE public.nfl_depth_charts
  ADD CONSTRAINT nfl_depth_charts_snapshot_slot_key
  UNIQUE (team, snapshot_at, pos_grp, pos_abb, pos_slot, pos_rank);
CREATE INDEX IF NOT EXISTS idx_nfl_depth_charts_team_snapshot ON public.nfl_depth_charts (team, snapshot_at);
COMMENT ON TABLE public.nfl_depth_charts IS
  'Rolling 28 day window of each club''s depth chart snapshots (nflverse depth_charts release, sync-nfl-injuries every 6 hours, only snapshots newer than stored are written). pos_rank 1 is the starter for that slot. The injury factor''s depth gate reads nfl_depth_rank_floor (each player''s best rank over the window) because clubs demote an injured starter the day he is hurt.';

CREATE OR REPLACE VIEW public.nfl_depth_rank_floor AS
SELECT team, espn_id, player_key, pos_abb,
       min(pos_rank) AS best_rank,
       count(DISTINCT snapshot_at) AS snapshots,
       max(snapshot_at) AS newest
FROM (
  SELECT team,
         nullif(espn_id, '') AS espn_id,
         regexp_replace(regexp_replace(lower(player_name), '[^a-z0-9 ]', '', 'g'), '\s+', ' ', 'g') AS player_key,
         pos_abb, pos_rank, snapshot_at
  FROM public.nfl_depth_charts
  WHERE snapshot_at >= now() - interval '28 days' AND pos_rank > 0
) q
GROUP BY team, espn_id, player_key, pos_abb;
COMMENT ON VIEW public.nfl_depth_rank_floor IS
  'Per club and player, the best (lowest) depth chart rank over the last 28 days of nflverse snapshots. Read by lib/services/football-injuries.js loadDepthRanks for the injury factor depth gate: rank 1 full position cost, rank 2 times injury_depth2_weight, rank 3 and below zero, unlisted times injury_depth_unknown_weight.';
GRANT SELECT ON public.nfl_depth_rank_floor TO service_role;

-- ---------------------------------------------------------------------
-- 2. The dials. Owner approved formula changes under directive 21.
-- ---------------------------------------------------------------------
INSERT INTO sport_dials (sport, dial, value) VALUES
  ('NFL', 'injury_depth2_weight', 0.5),
  ('NFL', 'injury_depth_unknown_weight', 0.5),
  ('__all__', 'seed_weight', 1),
  ('NFL', 'seed_weight', 0),
  ('NCAAF', 'seed_weight', 0)
ON CONFLICT (sport, dial) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

INSERT INTO model_weight_changes (sport, component, before, after, reason, source) VALUES
  ('NFL', 'injury factor depth chart gate (new dials injury_depth2_weight, injury_depth_unknown_weight)',
   jsonb_build_object('gate', 'none, every Out charged the full position cost whatever the depth chart said'),
   jsonb_build_object('gate', 'position cost times the player''s best depth rank over 28 days of snapshots: rank 1 full, rank 2 injury_depth2_weight', 'injury_depth2_weight', 0.5, 'injury_depth_unknown_weight', 0.5, 'rank_3_and_below', 0),
   'Owner 2026-09-15 "yes to all" on the Cardinals at Chargers upset. Week 1 charged Garrett Nussmeier (KC QB3) and Sam Ehlinger (DEN QB3) the starter''s 6pp, and Arizona''s four outs led by TE2 Tip Reiman 4.2pp against 2.2pp for the Chargers, moving the read 2pp toward the loser. Formula change: the NFL band regime restarts (band_fit_floors NFL 2026-09-16, __all__ map reset to identity). Judged in the weekly review against the football lookback factor table and the injury factor slope.',
   'owner-approved-2026-09-15'),
  ('NFL', 'seed_weight (new dial)',
   jsonb_build_object('seed_weight', 'absent, the playoff seed prior (0.5pp per seed of difference, capped 4pp) applied whenever ESPN listed both seeds, which for the NFL is every regular season week'),
   jsonb_build_object('seed_weight', 0, 'also', 'NCAAF 0, __all__ 1 (MLB unchanged, its seed factor cannot be replayed because the harness has no historical seeds, so it waits on the factor slope table after the freeze)'),
   'Owner 2026-09-15: "I don''t think playoff seed helps". A September seed is a standings position the market already priced, and on anchored football reads it argued toward the chalk for no information newer than the line (week 2 NFL reads carried Home higher playoff seed rows). Formula change for NFL and NCAAF only, same regime restart as the depth gate.',
   'owner-approved-2026-09-15');

UPDATE directives SET
  directive = directive || ' Amended 2026-09-15 (owner "yes to all"): two owner approved football formula changes, the NFL injury factor depth chart gate and seed_weight 0 for NFL and NCAAF, carry source owner-approved-2026-09-15; the football band regime restarts at 2026-09-16 (band_fit_floors) and the freeze otherwise stands.',
  check_sql = 'select id, sport, component, changed_at, source from model_weight_changes where changed_at >= ''2026-09-14 00:00:00-06'' and changed_at < ''2026-09-28 00:00:00-06'' and coalesce(source, '''') not in (''sunday-sweep-approved'', ''promote_ready_markets'', ''weekly-refresh'', ''directive-10-restore'', ''props-v2-seed'', ''owner-approved-2026-09-15'')',
  updated_at = now()
WHERE id = 21;

-- ---------------------------------------------------------------------
-- 3. Band regime per sport. A formula change makes the band calibration
--    a new regime for that sport (hard rule): the refit now honors a per
--    sport fit floor, NFL and NCAAF restart at 2026-09-16, and the
--    __all__ map (16 rows, football since 09-12 under the old formula)
--    resets to identity.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.band_fit_floors (
  sport text PRIMARY KEY,
  fit_floor date NOT NULL,
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.band_fit_floors IS
  'Per sport regime line for refresh_edge_band_calibration_raw: rows with a site day before the sport''s floor never enter that sport''s band fit, nor the __all__ pool. Advanced whenever a formula change alters how that sport''s claims are generated. The global p_fit_floor stays the default for sports without a row.';
ALTER TABLE public.band_fit_floors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS band_fit_floors_service ON public.band_fit_floors;
CREATE POLICY band_fit_floors_service ON public.band_fit_floors FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.band_fit_floors TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.band_fit_floors TO service_role;

INSERT INTO band_fit_floors (sport, fit_floor, reason) VALUES
  ('NFL', '2026-09-16', 'depth chart gate and seed_weight 0 (owner 2026-09-15)'),
  ('NCAAF', '2026-09-16', 'seed_weight 0 (owner 2026-09-15)')
ON CONFLICT (sport) DO UPDATE SET fit_floor = EXCLUDED.fit_floor, reason = EXCLUDED.reason, updated_at = now();

CREATE OR REPLACE FUNCTION public.refresh_edge_band_calibration_raw(
  p_window_days integer DEFAULT 45, p_min_n integer DEFAULT 25, p_damp numeric DEFAULT 0.5,
  p_min_sport_sample integer DEFAULT 60, p_fit_floor date DEFAULT '2026-09-08'::date,
  p_total_fit_floor date DEFAULT '2026-08-17'::date, p_totals_only boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $function$
declare
  sports text[]; s text;
  bands text[] := array['2-4','4-7','7-10','10+'];
  los numeric[] := array[2,4,7,10];
  his numeric[] := array[4,7,10,1000];
  ns int[]; centers numeric[]; delivered numeric[]; iso numeric[]; w numeric[];
  i int; changed boolean; cur numeric; pooled_n numeric; pooled_v numeric;
  prev_cal numeric; v_n int; v_center numeric; v_delivered numeric;
begin
  select array_agg(sport) into sports from (
    select '__all__' as sport
    union
    select a.sport from ai_suggestions a
     where a.session_id ~ '^auto_digest_\d{4}-\d{2}-\d{2}$'
       and a.voided_at is null
       and a.tier in ('Sharp Take','Strong Play','Play','Lean')
       and a.actual_outcome in ('won','lost')
       and a.edge_pp_raw is not null
       and (a.implied_prob is not null or a.odds ~ '^[+-]?[0-9]+$')
       and (a.game_date at time zone 'America/Denver')::date
             >= greatest((now() at time zone 'America/Denver')::date - p_window_days, p_fit_floor,
                         coalesce((select f.fit_floor from band_fit_floors f where f.sport = a.sport), p_fit_floor))
     group by a.sport
    having count(*) >= p_min_sport_sample
  ) q;

  if p_totals_only then sports := array[]::text[]; end if;

  foreach s in array coalesce(sports, array[]::text[]) loop
    ns := array[0,0,0,0]; centers := array[0,0,0,0]; delivered := array[0,0,0,0];
    for i in 1..4 loop
      select count(*),
             coalesce(avg(a.edge_pp_raw::numeric), (los[i] + least(his[i], 15)) / 2),
             coalesce(100.0 * (avg((a.actual_outcome = 'won')::int)
               - avg(coalesce(a.implied_prob::numeric,
                   case when a.odds::numeric > 0
                        then (100.0 / (a.odds::numeric + 100.0)) * 0.955
                        else (abs(a.odds::numeric) / (abs(a.odds::numeric) + 100.0)) * 0.955
                   end))), 0)
        into v_n, v_center, v_delivered
        from ai_suggestions a
       where a.session_id ~ '^auto_digest_\d{4}-\d{2}-\d{2}$'
         and a.voided_at is null
         and a.tier in ('Sharp Take','Strong Play','Play','Lean')
         and a.actual_outcome in ('won','lost')
         and a.edge_pp_raw is not null
         and (a.implied_prob is not null or a.odds ~ '^[+-]?[0-9]+$')
         and a.edge_pp_raw::numeric >= los[i] and a.edge_pp_raw::numeric < his[i]
         and (s = '__all__' or a.sport = s)
         and (a.game_date at time zone 'America/Denver')::date
               >= greatest((now() at time zone 'America/Denver')::date - p_window_days, p_fit_floor,
                           coalesce((select f.fit_floor from band_fit_floors f where f.sport = a.sport), p_fit_floor));
      ns[i] := v_n; centers[i] := v_center; delivered[i] := v_delivered;
      if ns[i] < p_min_n then delivered[i] := centers[i]; end if;
      if delivered[i] < 0 then delivered[i] := 0; end if;
    end loop;

    iso := delivered;
    w := array[greatest(ns[1],1)::numeric, greatest(ns[2],1)::numeric,
               greatest(ns[3],1)::numeric, greatest(ns[4],1)::numeric];
    loop
      changed := false;
      for i in 1..3 loop
        if iso[i] > iso[i+1] then
          pooled_v := (iso[i]*w[i] + iso[i+1]*w[i+1]) / (w[i] + w[i+1]);
          pooled_n := w[i] + w[i+1];
          iso[i] := pooled_v; iso[i+1] := pooled_v;
          w[i] := pooled_n; w[i+1] := pooled_n;
          changed := true;
        end if;
      end loop;
      exit when not changed;
    end loop;

    prev_cal := 0;
    for i in 1..4 loop
      select calibrated_center into cur
        from edge_band_calibration_raw
       where sport = s and market = '__all__' and band = bands[i];
      if cur is null then cur := iso[i]; end if;
      cur := (1 - p_damp) * cur + p_damp * iso[i];
      if cur < prev_cal then cur := prev_cal; end if;
      prev_cal := cur;
      insert into edge_band_calibration_raw
        (sport, market, band, claimed_center, calibrated_center, target_center, sample_n, window_days, fitted_at)
      values (s, '__all__', bands[i], round(centers[i],2), round(cur,2), round(iso[i],2), ns[i], p_window_days, now())
      on conflict (sport, market, band) do update set
        claimed_center = excluded.claimed_center,
        calibrated_center = excluded.calibrated_center,
        target_center = excluded.target_center,
        sample_n = excluded.sample_n,
        window_days = excluded.window_days,
        fitted_at = excluded.fitted_at;
    end loop;
  end loop;

  ns := array[0,0,0,0]; centers := array[0,0,0,0]; delivered := array[0,0,0,0];
  for i in 1..4 loop
    with settled as (
      select ga.total::numeric as total, ga.edges_raw::jsonb as er,
             gr.home_score, gr.away_score
      from game_analysis ga
      join game_results gr
        on gr.sport = ga.sport and gr.status = 'final'
       and gr.date = (ga.game_date at time zone 'America/Denver')::date
       and lower(gr.home_team_name) = lower(ga.home_team)
       and lower(gr.away_team_name) = lower(ga.away_team)
      where ga.sport = 'MLB' and ga.edges_raw is not null
        and (ga.game_date at time zone 'America/Denver')::date
              >= greatest((now() at time zone 'America/Denver')::date - p_window_days, p_total_fit_floor)
        and ga.game_date < now() - interval '4 hours'
    ),
    graded as (
      select greatest((er->>'over')::numeric, (er->>'under')::numeric) * 100 as e_pp,
        case when (er->>'over')::numeric >= (er->>'under')::numeric then
          case when (home_score + away_score) - total > 0 then 1
               when (home_score + away_score) - total < 0 then 0 end
        else
          case when (home_score + away_score) - total < 0 then 1
               when (home_score + away_score) - total > 0 then 0 end
        end as won_flag
      from settled
      where er ? 'over' and total is not null and home_score is not null
    )
    select count(*),
           coalesce(avg(e_pp), (los[i] + least(his[i], 15)) / 2),
           coalesce(100.0 * (avg(won_flag::numeric) - 0.5), 0)
      into v_n, v_center, v_delivered
      from graded
     where won_flag is not null and e_pp >= los[i] and e_pp < his[i];
    ns[i] := v_n; centers[i] := v_center; delivered[i] := v_delivered;
    if ns[i] < p_min_n then delivered[i] := 0; end if;
    if delivered[i] < 0 then delivered[i] := 0; end if;
  end loop;

  iso := delivered;
  w := array[greatest(ns[1],1)::numeric, greatest(ns[2],1)::numeric,
             greatest(ns[3],1)::numeric, greatest(ns[4],1)::numeric];
  loop
    changed := false;
    for i in 1..3 loop
      if iso[i] > iso[i+1] then
        pooled_v := (iso[i]*w[i] + iso[i+1]*w[i+1]) / (w[i] + w[i+1]);
        pooled_n := w[i] + w[i+1];
        iso[i] := pooled_v; iso[i+1] := pooled_v;
        w[i] := pooled_n; w[i+1] := pooled_n;
        changed := true;
      end if;
    end loop;
    exit when not changed;
  end loop;

  prev_cal := 0;
  for i in 1..4 loop
    select calibrated_center into cur
      from edge_band_calibration_raw
     where sport = 'MLB' and market = 'total' and band = bands[i];
    if cur is null then cur := iso[i]; end if;
    cur := (1 - p_damp) * cur + p_damp * iso[i];
    if cur < prev_cal then cur := prev_cal; end if;
    prev_cal := cur;
    insert into edge_band_calibration_raw
      (sport, market, band, claimed_center, calibrated_center, target_center, sample_n, window_days, fitted_at)
    values ('MLB', 'total', bands[i], round(centers[i],2), round(cur,2), round(iso[i],2), ns[i], p_window_days, now())
    on conflict (sport, market, band) do update set
      claimed_center = excluded.claimed_center,
      calibrated_center = excluded.calibrated_center,
      target_center = excluded.target_center,
      sample_n = excluded.sample_n,
      window_days = excluded.window_days,
      fitted_at = excluded.fitted_at;
  end loop;
end;
$function$;

-- The __all__ map back to identity: its 16 rows were football under the
-- formula that just changed.
UPDATE edge_band_calibration_raw
   SET calibrated_center = claimed_center, target_center = claimed_center, sample_n = 0, fitted_at = now()
 WHERE sport = '__all__' AND market = '__all__';

-- ---------------------------------------------------------------------
-- 4. Build 40: the weekly football lookback. For every settled anchored
--    read: did each factor argue toward the winner, which factor decided
--    the side, did the market move toward the winner. Aggregated per
--    factor family into an agent_reports row every Tuesday after the
--    nflverse week file lands. It moves no dial (directive 21), it feeds
--    the three test counterfactual and the Monday review.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lookback_reads (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  analysis_id uuid NOT NULL UNIQUE,
  sport text NOT NULL,
  game_key text,
  home_team text NOT NULL,
  away_team text NOT NULL,
  game_date timestamptz NOT NULL,
  home_score int,
  away_score int,
  home_won boolean NOT NULL,
  implied_home_prob numeric,
  calc_home_prob numeric,
  net_pp numeric,
  anchor_toward_winner boolean,
  net_toward_winner boolean,
  market_move_home_pp numeric,
  close_toward_winner boolean,
  recommended_side text,
  h2h_outcome text,
  h2h_raw_pp numeric,
  factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lookback_reads IS
  'One row per settled anchored football read (run_football_lookback, Tuesdays): home_won, the anchor, the net move and the market move each marked toward the winner or not, and factors [{family, factor, impact_pp, toward_winner, toward_close, decisive}] where decisive means removing that factor alone would have flipped the recommended side. Build_queue 40, owner 2026-09-15.';
ALTER TABLE public.lookback_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lookback_reads_service ON public.lookback_reads;
CREATE POLICY lookback_reads_service ON public.lookback_reads FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.lookback_reads TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.lookback_reads TO service_role;

CREATE OR REPLACE FUNCTION public.run_football_lookback(p_days integer DEFAULT 8, p_sports text[] DEFAULT ARRAY['NFL','NCAAF'], p_file boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql AS $$
declare
  v_rows int := 0;
  v_summary jsonb;
  v_families jsonb;
  v_misses jsonb;
  v_text text;
begin
  with reads as (
    select ga.id, ga.sport::text as sport, ga.game_key, ga.home_team::text as home_team, ga.away_team::text as away_team, ga.game_date,
           ga.implied_home_prob::numeric as ip, ga.calc_home_prob::numeric as cp,
           coalesce(ga.edge_factors->'adjustments', '[]'::jsonb) as adj, ga.recommended_side
    from game_analysis ga
    where ga.sport = any(p_sports)
      and ga.implied_home_prob is not null and ga.calc_home_prob is not null
      and ga.game_date >= now() - (p_days || ' days')::interval
      and ga.game_date < now() - interval '4 hours'
  ), scored as (
    -- One shadow row per read: the closing consensus join can double a
    -- read when a game was rescheduled inside the match window.
    select distinct on (r.id)
           r.*, s.home_score, s.away_score, s.side as h2h_side, s.price_clv_pp, s.outcome as h2h_outcome, s.raw_pp as h2h_raw,
           (s.home_score > s.away_score) as home_won,
           case s.side when 'home_ml' then s.price_clv_pp else -s.price_clv_pp end as move_home
    from reads r
    join shadow_reads_graded s on s.analysis_id = r.id and s.market = 'h2h'
    where s.home_score is not null and s.away_score is not null and s.home_score <> s.away_score
    order by r.id, s.price_clv_pp is null, s.close_price desc
  ), fx as (
    select sc.id,
           jsonb_agg(jsonb_build_object(
             'family', case when a->>'factor' ilike '%streak%' then 'Streak'
                            when a->>'factor' ilike '%playoff seed%' then 'Playoff seed'
                            else regexp_replace(a->>'factor', '\s*\(.*\)\s*$', '') end,
             'factor', a->>'factor',
             'impact_pp', round((a->>'impact')::numeric * 100, 2),
             'toward_winner', ((a->>'impact')::numeric > 0) = sc.home_won,
             'toward_close', case when sc.move_home is null or sc.move_home = 0 then null else ((a->>'impact')::numeric > 0) = (sc.move_home > 0) end,
             'decisive', ((sc.cp - (a->>'impact')::numeric) > sc.ip) <> (sc.cp > sc.ip)
           ) order by abs((a->>'impact')::numeric) desc) as factors
    from scored sc
    cross join lateral jsonb_array_elements(sc.adj) a
    where (a->>'impact') is not null and (a->>'impact')::numeric <> 0
    group by sc.id
  ), ins as (
    insert into lookback_reads (analysis_id, sport, game_key, home_team, away_team, game_date, home_score, away_score, home_won,
      implied_home_prob, calc_home_prob, net_pp, anchor_toward_winner, net_toward_winner, market_move_home_pp, close_toward_winner,
      recommended_side, h2h_outcome, h2h_raw_pp, factors)
    select sc.id, sc.sport, sc.game_key, sc.home_team, sc.away_team, sc.game_date, sc.home_score, sc.away_score, sc.home_won,
      round(sc.ip, 4), round(sc.cp, 4), round((sc.cp - sc.ip) * 100, 2),
      (sc.ip > 0.5) = sc.home_won,
      case when sc.cp = sc.ip then null else (sc.cp > sc.ip) = sc.home_won end,
      round(sc.move_home, 2),
      case when sc.move_home is null or sc.move_home = 0 then null else (sc.move_home > 0) = sc.home_won end,
      sc.recommended_side, sc.h2h_outcome, sc.h2h_raw, coalesce(fx.factors, '[]'::jsonb)
    from scored sc left join fx on fx.id = sc.id
    on conflict (analysis_id) do update set
      home_score = excluded.home_score, away_score = excluded.away_score, home_won = excluded.home_won,
      implied_home_prob = excluded.implied_home_prob, calc_home_prob = excluded.calc_home_prob, net_pp = excluded.net_pp,
      anchor_toward_winner = excluded.anchor_toward_winner, net_toward_winner = excluded.net_toward_winner,
      market_move_home_pp = excluded.market_move_home_pp, close_toward_winner = excluded.close_toward_winner,
      recommended_side = excluded.recommended_side, h2h_outcome = excluded.h2h_outcome, h2h_raw_pp = excluded.h2h_raw_pp,
      factors = excluded.factors, created_at = now()
    returning 1
  )
  select count(*) into v_rows from ins;

  -- Per sport headline: how often the anchor, the net move, and the
  -- market move pointed at the winner.
  select jsonb_object_agg(sport, row) into v_summary from (
    select sport, jsonb_build_object(
      'reads', count(*),
      'anchor_right_pct', round(100.0 * avg(anchor_toward_winner::int), 1),
      'net_moved', count(net_toward_winner),
      'net_right_pct', round(100.0 * avg(net_toward_winner::int), 1),
      'close_known', count(close_toward_winner),
      'close_right_pct', round(100.0 * avg(close_toward_winner::int), 1),
      'upsets', count(*) filter (where not anchor_toward_winner)) as row
    from lookback_reads
    where sport = any(p_sports) and game_date >= now() - (p_days || ' days')::interval
    group by sport) q;

  -- Per factor family: direction hit rate against the outcome and
  -- against the close, mean size, and how often it decided the side.
  select jsonb_agg(row order by sport, n desc) into v_families from (
    select lr.sport, f->>'family' as family, count(*) as n,
      jsonb_build_object(
        'sport', lr.sport, 'family', f->>'family', 'n', count(*),
        'toward_winner_pct', round(100.0 * avg(((f->>'toward_winner')::boolean)::int), 1),
        'toward_close_pct', round(100.0 * avg(((f->>'toward_close')::boolean)::int), 1),
        'mean_abs_pp', round(avg(abs((f->>'impact_pp')::numeric)), 2),
        'decisive_n', count(*) filter (where (f->>'decisive')::boolean),
        'decisive_right_n', count(*) filter (where (f->>'decisive')::boolean and (f->>'toward_winner')::boolean)) as row
    from lookback_reads lr cross join lateral jsonb_array_elements(lr.factors) f
    where lr.sport = any(p_sports) and lr.game_date >= now() - (p_days || ' days')::interval
    group by lr.sport, f->>'family') q;

  -- The misses worth a sentence: reads where the net move went the
  -- wrong way by a point or more, with the biggest wrong way factor.
  select jsonb_agg(row order by abs_net desc) into v_misses from (
    select abs(lr.net_pp) as abs_net, jsonb_build_object(
      'sport', lr.sport, 'game', lr.away_team || ' at ' || lr.home_team, 'date', (lr.game_date at time zone 'America/Denver')::date,
      'score', lr.away_score || '-' || lr.home_score, 'implied_home', round(lr.implied_home_prob * 100, 1), 'net_pp', lr.net_pp,
      'market_move_home_pp', lr.market_move_home_pp, 'recommended', lr.recommended_side, 'h2h', lr.h2h_outcome,
      'wrong_way_factor', (select f->>'factor' from jsonb_array_elements(lr.factors) f where not (f->>'toward_winner')::boolean order by abs((f->>'impact_pp')::numeric) desc limit 1),
      'wrong_way_pp', (select f->>'impact_pp' from jsonb_array_elements(lr.factors) f where not (f->>'toward_winner')::boolean order by abs((f->>'impact_pp')::numeric) desc limit 1)) as row
    from lookback_reads lr
    where lr.sport = any(p_sports) and lr.game_date >= now() - (p_days || ' days')::interval
      and lr.net_toward_winner = false and abs(lr.net_pp) >= 1
    limit 12) q;

  v_text := format('Football lookback, last %s days: %s reads scored. %s', p_days, v_rows,
    (select string_agg(format('%s: anchor right %s%%, net move right %s%% of %s, close right %s%% of %s, %s upsets', k, v->>'anchor_right_pct', v->>'net_right_pct', v->>'net_moved', v->>'close_right_pct', v->>'close_known', v->>'upsets'), '. ')
       from jsonb_each(coalesce(v_summary, '{}'::jsonb)) e(k, v)));

  if p_file then
    insert into agent_reports (agent, summary, findings) values (
      'football-lookback', v_text,
      jsonb_build_object('days', p_days, 'sports', to_jsonb(p_sports), 'rows', v_rows, 'per_sport', coalesce(v_summary, '{}'::jsonb),
        'factor_families', coalesce(v_families, '[]'::jsonb), 'misses', coalesce(v_misses, '[]'::jsonb),
        'reading', 'A family whose toward_winner_pct sits near 50 is noise, one under 50 is arguing the wrong way, one whose toward_close_pct is high is pricing what the book already moved on. decisive_n says how often it alone chose the side. No dial moves from here (directive 21): a candidate goes through the three test counterfactual.'));
  end if;

  return jsonb_build_object('rows', v_rows, 'per_sport', coalesce(v_summary, '{}'::jsonb),
    'factor_families', coalesce(v_families, '[]'::jsonb), 'misses', coalesce(v_misses, '[]'::jsonb), 'summary', v_text);
end;
$$;

-- Tuesday 09:00 MT (15:00 UTC), after the Monday night game settles and
-- the nflverse week file lands.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'football-lookback-weekly') THEN
    PERFORM cron.unschedule('football-lookback-weekly');
  END IF;
END $$;
SELECT cron.schedule('football-lookback-weekly', '0 15 * * 2', $$ select public.run_football_lookback(8); $$);

-- ---------------------------------------------------------------------
-- 5. Retire the daily LLM postmortem (owner 2026-09-15). Five settled
--    picks a day into ai_suggestions.post_analysis that no review reads.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'analyze-outcomes-daily') THEN
    PERFORM cron.unschedule('analyze-outcomes-daily');
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 6. Build queue.
-- ---------------------------------------------------------------------
UPDATE build_queue SET status = 'done', updated_at = now(),
  detail = detail || ' DONE 2026-09-15 (migration 20260915210000): run_football_lookback(p_days) scores every settled anchored NFL and NCAAF read from game_analysis and shadow_reads_graded into lookback_reads (each factor toward the winner or not, decisive factors, market move toward the winner) and files an agent_reports row from agent football-lookback with per sport headline, per factor family table, and the misses; cron football-lookback-weekly Tuesdays 09:00 MT. Stored factor impacts stand in for the replay (removing a factor is subtracting its impact, the formula is additive before the cap), so no harness change was needed. analyze-outcomes-daily unscheduled the same day.'
WHERE id = 40;

INSERT INTO build_queue (priority, status, title, detail) VALUES
  ('medium', 'done', 'NFL injury factor depth chart gate and seed_weight dial (owner 2026-09-15)',
   'Owner "yes to all" on 2026-09-15. Depth gate: nfl_depth_charts keeps a rolling 28 day window, nfl_depth_rank_floor gives each player''s best rank, positionImpact multiplies by rank 1 full, rank 2 injury_depth2_weight (NFL 0.5), rank 3 and below 0, unlisted injury_depth_unknown_weight (NFL 0.5). ESPN report lines now carry espnId, depth_rank and depth_weight into edge_factors.injuryReport. seed_weight dial: __all__ 1, NFL 0, NCAAF 0. Both recorded in model_weight_changes with source owner-approved-2026-09-15, directive 21 amended, band_fit_floors NFL and NCAAF 2026-09-16, __all__ band map reset to identity.'),
  ('low', 'pending', 'MLB playoff seed prior: keep or zero after the freeze',
   'Owner 2026-09-15 doubts the seed prior helps anywhere. MLB keeps seed_weight 1 through the freeze because the replay harness has no historical seeds (standingsAsOf returns playoff_seed null), so the Sunday sweep cannot test it. Decide from the factor slope table (review section 3d) on 2026-09-28: a seed slope near zero or negative on 50+ picks means zero it through sport_dials plus a model_weight_changes row.');
