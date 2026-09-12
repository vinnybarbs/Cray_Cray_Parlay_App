-- Model sanity tripwires (owner, 2026-09-12: "have a review that would
-- catch dogshit records publishing to users, across all sports").
--
-- The daily ops check verified that jobs ran, feeds were fresh and the
-- ledger reconciled while every NFL home team read 5pp above the market,
-- MLB published 117 home picks to 9 away in a week, and 123 of 124 NCAAF
-- tiles showed 0-0 two weeks into the season. Nothing asked whether the
-- reads made sense. model_sanity_findings() asks, every day, through
-- directive 18's check_sql. Any returned row is a finding.
--
-- pick_clv_by_factor splits closing line value by the factor stack so the
-- Monday review names the next double count by the market's verdict,
-- not by feel (the home advantage double count was found by hand).

-- The scoreboard record on game_results is only this season's from the
-- sport's regular season floor (NFL preseason results carry 3-0 style
-- records in August). Mirror of seasonRecordFloor in
-- lib/services/tile-records.js.
create or replace function public.season_record_floor(p_sport text, p_today date default current_date)
returns date
language sql immutable
as $$
  select case
    when md is null then p_today - 45
    when make_date(extract(year from p_today)::int, md[1], md[2]) > p_today
      then make_date(extract(year from p_today)::int - 1, md[1], md[2])
    else make_date(extract(year from p_today)::int, md[1], md[2]) end
  from (select case p_sport
    when 'NFL' then array[9, 1] when 'NCAAF' then array[8, 20] when 'MLB' then array[3, 15]
    when 'MLS' then array[2, 15] when 'NBA' then array[10, 15] when 'NHL' then array[10, 1]
    when 'NCAAB' then array[11, 1] when 'EPL' then array[8, 1] end as md) f;
$$;

create or replace function public.model_sanity_findings()
returns table (tripwire text, sport text, n bigint, value numeric, detail text)
language sql stable
as $$
with published as (
  select s.sport, s.bet_type, s.home_team, s.away_team, s.pick, s.created_at, s.game_date
  from ai_suggestions s
  where s.session_id ~ '^auto_digest_\d{4}-\d{2}-\d{2}$'
    and s.voided_at is null
    and s.tier in ('Sharp Take','Strong Play','Play','Lean')
    and s.created_at >= now() - interval '7 days'
),
-- 1. Side balance: a model that likes one side of the field is pricing
--    the venue, not the game.
side_balance as (
  select p.sport, count(*) as n,
    sum(case when p.pick ilike p.home_team || '%' then 1 else 0 end) as home_n
  from published p
  where p.bet_type not ilike '%total%'
  group by p.sport
),
recent as (
  select g.* from game_analysis g where g.game_date >= current_date - 1
),
-- 2. Anchored reads should average near the market. A sport whose mean
--    raw home moneyline read sits 2pp or more from zero carries a bias.
anchored_mean as (
  select r.sport, count(*) as n, avg((r.edges_raw->>'home_ml')::numeric) * 100 as mean_pp
  from recent r
  where r.implied_home_prob is not null and r.edges_raw ? 'home_ml'
  group by r.sport
),
-- 3. A factor pinned at its cap on most rows is a broken input, not a signal.
capped as (
  select r.sport, count(*) as n,
    count(*) filter (where exists (
      select 1 from jsonb_array_elements(coalesce(r.edge_factors->'adjustments','[]'::jsonb)) a
      where abs(coalesce((a->>'impact')::numeric, 0)) >= 0.08)) as capped_n
  from recent r
  group by r.sport
),
-- 4. Home advantage must never sit on an anchored base (PR 156).
home_adv_anchor as (
  select r.sport, count(*) as n
  from recent r
  where r.implied_home_prob is not null
    and r.generated_at > '2026-09-12 10:09:00-06'
    and exists (select 1 from jsonb_array_elements(coalesce(r.edge_factors->'adjustments','[]'::jsonb)) a where a->>'factor' = 'Home advantage')
  group by r.sport
),
-- 5. Tile records behind the scoreboard: the team has a settled result
--    this season and the tile shows nothing or 0-0.
team_sports as (select unnest(array['MLB','NFL','NCAAF','NBA','NCAAB','NHL','MLS','EPL']) as sport),
tile_rows as (
  select r.sport, r.home_team as team, r.home_record as record, r.game_date from recent r join team_sports t on t.sport = r.sport
  union all
  select r.sport, r.away_team, r.away_record, r.game_date from recent r join team_sports t on t.sport = r.sport
),
stale_records as (
  select tr.sport, count(*) as n,
    string_agg(distinct tr.team || ' tile ' || coalesce(tr.record, 'blank') || ' vs scoreboard ' || lr.record_str, '; ') as examples
  from tile_rows tr
  join team_latest_record lr on lr.sport = tr.sport and lower(lr.team_name) = lower(tr.team)
    and lr.as_of_date >= public.season_record_floor(tr.sport)
  where (tr.record is null or tr.record ~ '^0-0')
    and lr.record_str ~ '^\d+-\d+' and lr.record_str !~ '^0-0'
  group by tr.sport
),
-- 6. A published pick on a team sport whose tile carries no record.
recordless_picks as (
  select p.sport, count(*) as n, string_agg(distinct p.pick, '; ') as examples
  from published p
  join team_sports t on t.sport = p.sport
  join game_analysis g on g.sport = p.sport and g.home_team = p.home_team and g.away_team = p.away_team
    and abs(extract(epoch from g.game_date - p.game_date)) <= 43200
  where p.created_at >= now() - interval '2 days'
    and (g.home_record is null or g.away_record is null)
  group by p.sport
),
-- 7. The market closing against a sport and market for two weeks.
clv as (
  select c.sport, c.market_type, count(*) as n, avg(c.price_clv_pp) as avg_clv
  from pick_clv_all c
  where c.game_date >= now() - interval '14 days' and c.tier in ('Sharp Take','Strong Play','Play','Lean')
  group by c.sport, c.market_type
)
select 'side_balance'::text, sb.sport::text, sb.n, round(100.0 * sb.home_n / sb.n, 1),
  format('%s of %s bet-tier picks on the home side in 7 days (limit 75 pct either way on 20+)', sb.home_n, sb.n)
from side_balance sb where sb.n >= 20 and (sb.home_n >= 0.75 * sb.n or sb.home_n <= 0.25 * sb.n)
union all
select 'anchored_mean_raw', am.sport::text, am.n, round(am.mean_pp, 2),
  format('mean raw home moneyline read %spp across %s anchored games (limit 2pp either way on 10+)', round(am.mean_pp, 2), am.n)
from anchored_mean am where am.n >= 10 and abs(am.mean_pp) >= 2
union all
select 'factor_at_cap', c.sport::text, c.n, round(100.0 * c.capped_n / c.n, 1),
  format('%s of %s games carry a single factor at 8pp or more (limit 50 pct on 10+)', c.capped_n, c.n)
from capped c where c.n >= 10 and c.capped_n > 0.5 * c.n
union all
select 'home_adv_on_anchor', h.sport::text, h.n, h.n::numeric,
  format('%s anchored games carry a Home advantage factor after PR 156', h.n)
from home_adv_anchor h
union all
select 'stale_tile_record', s.sport::text, s.n, s.n::numeric, left(s.examples, 400)
from stale_records s
union all
select 'recordless_pick', rp.sport::text, rp.n, rp.n::numeric, left('published with a blank tile record: ' || rp.examples, 400)
from recordless_picks rp
union all
select 'clv_negative', v.sport::text || ' ' || v.market_type, v.n, round(v.avg_clv, 2),
  format('average price CLV %spp on %s picks in 14 days (limit -1pp on 20+)', round(v.avg_clv, 2), v.n)
from clv v where v.n >= 20 and v.avg_clv <= -1;
$$;

comment on function public.model_sanity_findings() is
  'Daily model sanity tripwires (directive 18). Every returned row is a finding: side balance, anchored mean raw read, factor at cap, home advantage on an anchored base, stale or blank tile records, recordless published picks, negative closing line value.';

-- Closing line value by factor: which inputs the market agrees with.
-- Impact is signed toward the picked side (positive = the factor argued
-- for the pick). Totals carry the factor at face value with side null.
create or replace view public.pick_clv_by_factor as
select c.id as pick_id, c.sport, c.market_type, c.tier, c.pick, c.game_date, c.actual_outcome,
  c.edge_pp, c.price_clv_pp, c.line_clv_points,
  case
    when c.market_type = 'totals' then null
    when c.pick ilike g.home_team || '%' then 'home'
    when c.pick ilike g.away_team || '%' then 'away'
    else null end as pick_side,
  a->>'factor' as factor_raw,
  trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(a->>'factor', g.home_team, 'team', 'g'), g.away_team, 'team', 'g'), '\s*\([^)]*\)', '', 'g'), '\b[WL]\d+ streak', 'streak', 'g')) as factor_key,
  (a->>'impact')::numeric as impact_home,
  case
    when c.market_type = 'totals' then (a->>'impact')::numeric
    when c.pick ilike g.away_team || '%' then -((a->>'impact')::numeric)
    else (a->>'impact')::numeric end as impact_for_pick
from pick_clv_all c
join ai_suggestions s on s.id = c.id
join game_analysis g on g.sport = c.sport and g.home_team = s.home_team and g.away_team = s.away_team
  and abs(extract(epoch from g.game_date - c.game_date)) <= 43200
cross join lateral jsonb_array_elements(coalesce(g.edge_factors->'adjustments', '[]'::jsonb)) a
where a ? 'impact';

comment on view public.pick_clv_by_factor is
  'One row per published pick per factor in its stack (current game_analysis row), with price CLV. Canonical query: group by sport, factor_key where impact_for_pick > 0, report n, avg price_clv_pp, pct beating close, record.';

-- Directive 18: the tripwires run every day through the compliance sweep.
insert into directives (directive, decided_on, enforcement, check_sql, notes, status)
values (
  'Model sanity tripwires run every day across every sport, and any tripped row is a finding at the top of the ops brief: side balance over 75 percent one way, anchored mean raw read 2pp or more from the market, a factor at its cap on most rows, home advantage on an anchored base, a tile record behind the scoreboard, a published pick with a blank record, or a sport whose closing line value averages -1pp or worse for two weeks. A tripped wire is fixed at the source or explained on the blackboard the same day.',
  '2026-09-12',
  'public.model_sanity_findings() via this check_sql; traphawk-ops-check section 8; traphawk-performance-review section 5 (pick_clv_by_factor)',
  'select tripwire, sport, n, value, detail from public.model_sanity_findings()',
  'Owner, 2026-09-12: the ops check ran clean every day while every NFL home read sat 5pp over the market, MLB published 117 home to 9 away in a week, and 123 of 124 NCAAF tiles showed 0-0 two weeks in. The automation checked that things ran, not that they were right.',
  'active'
);

-- Directive 19: a base change re-audits every factor.
insert into directives (directive, decided_on, enforcement, notes, status)
values (
  'Any change to what a read is based on (the market anchor, the record blend, a new anchor source) re-audits every factor in the stack for information the new base already prices, before it ships. A factor that prices the same thing as the base is a double count and comes off the anchored path.',
  '2026-09-12',
  'traphawk-ship pre-merge checklist; traphawk-performance-review factor table; the anchored_mean_raw and side_balance tripwires catch what the audit misses',
  'The market anchor landed 2026-09-02 without this audit. Home advantage (the book already prices home field) counted twice for ten days and drove 36 of 47 anchor-era MLB moneyline picks to the home side, beating the close 22 percent of the time.',
  'active'
);
