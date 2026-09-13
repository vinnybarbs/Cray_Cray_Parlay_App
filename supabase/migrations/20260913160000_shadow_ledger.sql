-- The shadow ledger (owner, 2026-09-13: "ship it").
--
-- Shadow sports and muted markets were graded by whoever remembered to
-- run the join: shadow_model_readiness() covered UFC and soccer, NCAAF
-- had no ledger at all, and the CLV views read published picks only, so
-- the closing line never judged a market until it was already live.
--
-- shadow_reads_graded grades EVERY stored read for every sport and
-- market (the better side of each market in edges_raw) against the
-- final and the closing consensus. shadow_market_readiness() sums it to
-- the go-live bar per sport and market: 75 publishable graded reads
-- (raw 2pp or more), actual at or above implied, positive units, and a
-- positive average closing line value. Directive 20 reports a market
-- at the bar, or a shadow market closing negative, every day.

create or replace view public.shadow_reads_graded as
with g as (
  select distinct on (ga.id)
    ga.id, ga.sport, ga.home_team, ga.away_team, ga.game_date,
    (ga.game_date at time zone 'America/Denver')::date as site_day,
    ga.spread::numeric as spread, ga.total::numeric as total,
    ga.moneyline_home, ga.moneyline_away, ga.spread_home_price, ga.spread_away_price, ga.over_price, ga.under_price,
    ga.edges_raw, ga.edges, ga.implied_home_prob,
    gr.home_score, gr.away_score
  from game_analysis ga
  join game_results gr on gr.sport = ga.sport and gr.status = 'final'
    and gr.date = (ga.game_date at time zone 'America/Denver')::date
    and lower(gr.home_team_name) = lower(ga.home_team) and lower(gr.away_team_name) = lower(ga.away_team)
  where ga.edges_raw is not null and gr.home_score is not null and gr.away_score is not null
  order by ga.id, gr.id
),
m as (
  select g.*, mk.market,
    case mk.market
      when 'h2h' then case when coalesce((g.edges_raw->>'home_ml')::numeric, -1) >= coalesce((g.edges_raw->>'away_ml')::numeric, -1) then 'home_ml' else 'away_ml' end
      when 'spreads' then case when coalesce((g.edges_raw->>'home_spread')::numeric, -1) >= coalesce((g.edges_raw->>'away_spread')::numeric, -1) then 'home_spread' else 'away_spread' end
      else case when coalesce((g.edges_raw->>'over')::numeric, -1) >= coalesce((g.edges_raw->>'under')::numeric, -1) then 'over' else 'under' end
    end as side
  from g
  cross join (values ('h2h'), ('spreads'), ('totals')) as mk(market)
  where (mk.market = 'h2h' and g.edges_raw ? 'home_ml' and g.moneyline_home is not null and g.moneyline_away is not null)
     or (mk.market = 'spreads' and g.edges_raw ? 'home_spread' and g.spread is not null)
     or (mk.market = 'totals' and g.edges_raw ? 'over' and g.total is not null)
),
s as (
  select m.*,
    round((m.edges_raw->>m.side)::numeric * 100, 2) as raw_pp,
    round(coalesce((m.edges->>m.side)::numeric, 0) * 100, 2) as cal_pp,
    case m.side when 'home_ml' then m.moneyline_home::numeric when 'away_ml' then m.moneyline_away::numeric
      when 'home_spread' then m.spread_home_price::numeric when 'away_spread' then m.spread_away_price::numeric
      when 'over' then m.over_price::numeric else m.under_price::numeric end as stored_price,
    case m.side when 'home_spread' then m.spread when 'away_spread' then -m.spread when 'over' then m.total when 'under' then m.total else null end as point,
    case m.side when 'home_ml' then m.home_team when 'away_ml' then m.away_team when 'home_spread' then m.home_team when 'away_spread' then m.away_team when 'over' then 'Over' else 'Under' end as side_name,
    m.home_score - m.away_score as margin, m.home_score + m.away_score as points,
    m.sport in ('EPL','MLS','Soccer','World Cup','Champions League','Copa America','Euros') as three_way
  from m
),
o as (
  select s.*,
    case s.side
      when 'home_ml' then case when s.margin > 0 then 'won' when s.margin < 0 then 'lost' when s.three_way then 'lost' else 'push' end
      when 'away_ml' then case when s.margin < 0 then 'won' when s.margin > 0 then 'lost' when s.three_way then 'lost' else 'push' end
      when 'home_spread' then case when s.margin + s.spread > 0 then 'won' when s.margin + s.spread < 0 then 'lost' else 'push' end
      when 'away_spread' then case when s.margin + s.spread < 0 then 'won' when s.margin + s.spread > 0 then 'lost' else 'push' end
      when 'over' then case when s.points > s.total then 'won' when s.points < s.total then 'lost' else 'push' end
      else case when s.points < s.total then 'won' when s.points > s.total then 'lost' else 'push' end
    end as outcome,
    coalesce(s.stored_price, case when s.market = 'h2h' then null else -110 end) as price,
    (s.stored_price is null and s.market <> 'h2h') as price_default
  from s
)
select o.id as analysis_id, o.sport, o.market, o.side, o.side_name, o.home_team, o.away_team, o.game_date, o.site_day,
  o.raw_pp, o.cal_pp, (o.raw_pp >= 2) as publishable, o.point, o.price, o.price_default,
  (o.implied_home_prob is not null) as anchored,
  o.home_score, o.away_score, o.outcome,
  case when o.outcome = 'won' then case when o.price > 0 then o.price / 100.0 else 100.0 / abs(o.price) end
       when o.outcome = 'lost' then -1 else 0 end as units,
  implied_pp(o.price) as stored_implied_pp,
  cl.close_price, cl.close_point, cl.books,
  implied_pp(cl.close_price) - implied_pp(o.price) as price_clv_pp,
  case o.market
    when 'totals' then case when o.side = 'over' then cl.close_point - o.point else o.point - cl.close_point end
    when 'spreads' then o.point - cl.close_point
    else null end as line_clv_points,
  (o.market = 'h2h' or o.point = cl.close_point) as same_line
from o
left join closing_consensus cl on cl.market_type = o.market and cl.name = o.side_name
  and cl.home_team = o.home_team and cl.away_team = o.away_team
  and abs(extract(epoch from cl.commence_time - o.game_date)) <= 10800
where o.price is not null;

comment on view public.shadow_reads_graded is
  'Every stored read (better side of each market in game_analysis.edges_raw) graded against the final and the closing consensus, all sports. publishable = raw 2pp or more. Spread and total prices default to -110 when the row stored none (price_default). Same-day doubleheaders resolve to the first result row.';

create or replace function public.shadow_market_readiness(p_since date default '2026-07-23')
returns table (sport text, market text, graded bigint, publishable bigint, wins bigint, losses bigint,
               actual_pct numeric, implied_pct numeric, units numeric, clv_n bigint, avg_clv_pp numeric,
               pct_beat_close numeric, ready boolean)
language sql stable
as $$
  select a.*,
    (a.publishable >= 75 and a.actual_pct is not null and a.actual_pct >= a.implied_pct
       and a.units > 0 and coalesce(a.avg_clv_pp, 0) > 0) as ready
  from (
    select r.sport::text, r.market::text,
      count(*) as graded,
      count(*) filter (where r.publishable and r.outcome in ('won','lost')) as publishable,
      count(*) filter (where r.publishable and r.outcome = 'won') as wins,
      count(*) filter (where r.publishable and r.outcome = 'lost') as losses,
      round(100.0 * count(*) filter (where r.publishable and r.outcome = 'won')
        / nullif(count(*) filter (where r.publishable and r.outcome in ('won','lost')), 0), 1) as actual_pct,
      round(avg(r.stored_implied_pp) filter (where r.publishable and r.outcome in ('won','lost')), 1) as implied_pct,
      round(coalesce(sum(r.units) filter (where r.publishable), 0)::numeric, 2) as units,
      count(*) filter (where r.publishable and r.price_clv_pp is not null) as clv_n,
      round(avg(r.price_clv_pp) filter (where r.publishable), 2) as avg_clv_pp,
      round(100.0 * count(*) filter (where r.publishable and r.price_clv_pp > 0)
        / nullif(count(*) filter (where r.publishable and r.price_clv_pp is not null), 0), 1) as pct_beat_close
    from public.shadow_reads_graded r
    where r.site_day >= p_since
    group by r.sport, r.market
  ) a;
$$;

comment on function public.shadow_market_readiness(date) is
  'Go-live bar per sport and market from the shadow ledger: 75 publishable graded reads, actual at or above implied, positive units, positive closing line value. Covers live markets too (their published record still rules); the readiness call applies to shadow sports and muted markets.';

-- Directive 20: shadow markets are judged on the shadow ledger, daily.
insert into directives (directive, decided_on, enforcement, check_sql, notes, status)
values (
  'Every shadow sport and every muted market is judged on the shadow ledger (shadow_reads_graded, shadow_market_readiness): 75 publishable graded reads, actual at or above implied, positive units, and a positive closing line value. A market at the bar is reported as an owner decision the day it gets there; a shadow market closing -1pp or worse on 50 or more reads is reported as not ready and named. Go-live and re-entry decisions cite these numbers, never a hand-run join.',
  '2026-09-13',
  'public.shadow_market_readiness() via this check_sql; traphawk-performance-review section 5; traphawk-ops-check section 8',
  'select r.sport, r.market, r.publishable, r.actual_pct, r.implied_pct, r.units, r.avg_clv_pp, r.pct_beat_close, r.ready from public.shadow_market_readiness() r where (r.sport in (''NCAAF'',''EPL'',''MLS'',''Soccer'',''World Cup'',''Champions League'',''Copa America'',''Euros'') or exists (select 1 from edge_calibration e where e.key = r.sport || '':'' || case r.market when ''h2h'' then ''ml'' when ''spreads'' then ''spread'' else ''total'' end and e.multiplier = 0)) and (r.ready or (r.publishable >= 50 and r.avg_clv_pp <= -1))',
  'Owner 2026-09-13: "what does that data do for us". Until today NCAAF had no ledger and the closing line never saw a shadow market. First run: see agent_reports.',
  'active'
);
