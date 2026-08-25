-- Factor attribution: stage one of the factor learning loop (owner
-- approved 2026-08-24, read-only stage).
--
-- Every analyzed game stores each factor's exact contribution to the
-- home win probability (edge_factors->adjustments) and the market's
-- devigged implied probability. Joined to final scores, that is a
-- supervised dataset: per factor, regress the outcome residual against
-- the factor's impact, the same slope estimator the flat-k calibration
-- uses, but per factor.
--
--   slope ~ 1  : the factor is sized about right and the market has not
--                priced it away
--   slope >> 1 : underweighted, it predicts more than it is credited
--   slope ~ 0  : priced in, adds nothing beyond the market
--   slope <  0 : anti-signal at the current weight
--
-- STAGING RULE: this function informs the Monday review only. No
-- coefficient changes on its say-so until the owner has watched its
-- recommendations stay stable across consecutive weeks and explicitly
-- approves each nudge. The learning loop earns write access the same
-- way every factor earns its weight: with evidence.
create or replace function public.factor_attribution(
  p_since date default date '2026-08-17',
  p_sport text default 'MLB'
) returns table (
  factor text,
  games int,
  avg_abs_impact_pp numeric,
  slope numeric,
  note text
) language sql stable as $fn$
with g as (
  select ga.game_key,
    (ga.game_date at time zone 'America/New_York')::date as eday,
    ga.home_team, ga.away_team,
    ga.implied_home_prob::numeric as imp_home,
    a.value as adj
  from game_analysis ga, jsonb_array_elements(ga.edge_factors->'adjustments') a
  where ga.sport ilike p_sport
    and (ga.game_date at time zone 'America/Denver')::date >= p_since
    and ga.implied_home_prob is not null
),
r as (
  select date, home_team_name, away_team_name,
    max(case when home_score > away_score then 1 else 0 end) as home_won,
    count(*) as n_results
  from game_results
  where sport = p_sport and status = 'final'
  group by 1, 2, 3
),
j as (
  select
    case
      when g.adj->>'factor' = 'Home advantage' then 'home_adv'
      when g.adj->>'factor' = 'Probable starters' then 'pitcher'
      when g.adj->>'factor' ilike '%schedule%' then 'sos'
      when g.adj->>'factor' ilike '%streak%' then 'streak'
      when g.adj->>'factor' ilike '%seed%' then 'seed'
      when (g.adj->>'factor' ilike '%at home%' or g.adj->>'factor' ilike '%on road%')
           and g.adj->>'factor' not ilike 'Injury%' then 'venue'
      when g.adj->>'factor' ilike 'Injury impact%' then 'injury'
      when g.adj->>'factor' ilike '%form%' then 'form'
      else 'other'
    end as factor,
    (g.adj->>'impact')::numeric as x,
    (r.home_won - g.imp_home) as y
  from g
  join r on r.date = g.eday
        and r.home_team_name = g.home_team
        and r.away_team_name = g.away_team
        and r.n_results = 1
  where (g.adj->>'impact')::numeric is not null
    and (g.adj->>'impact')::numeric <> 0
)
select factor,
  count(*)::int as games,
  round(avg(abs(x)) * 100, 2) as avg_abs_impact_pp,
  round((sum(x * y) / nullif(sum(x * x), 0))::numeric, 2) as slope,
  case
    when count(*) < 25 then 'thin sample, read nothing yet'
    when (sum(x * y) / nullif(sum(x * x), 0)) >= 0.5 then 'earning its weight or underweighted'
    when (sum(x * y) / nullif(sum(x * x), 0)) >= 0 then 'weak positive, roughly priced in'
    else 'anti-signal at current weight'
  end as note
from j
group by factor
order by slope desc nulls last;
$fn$;

grant execute on function public.factor_attribution(date, text) to service_role;
