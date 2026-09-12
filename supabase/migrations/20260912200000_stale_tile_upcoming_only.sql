-- stale_tile_record counts only games still on the board (see the
-- tile_rows comment). Same function otherwise.

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
-- Only tiles still on the board: a game that already kicked off is never
-- re-analyzed, so its record cannot refresh and would trip the wire for
-- a day after every fix (2026-09-12, 18 NCAAF games that started before
-- the tile fix landed).
tile_rows as (
  select r.sport, r.home_team as team, r.home_record as record, r.game_date from recent r join team_sports t on t.sport = r.sport where r.game_date > now() - interval '1 hour'
  union all
  select r.sport, r.away_team, r.away_record, r.game_date from recent r join team_sports t on t.sport = r.sport where r.game_date > now() - interval '1 hour'
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

