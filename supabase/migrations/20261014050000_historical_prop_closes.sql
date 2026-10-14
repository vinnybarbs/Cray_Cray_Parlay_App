-- NFL player prop history (owner 2026-10-13, "All, in that order": soccer
-- closes first, NFL prop history second, multi season closes third).
--
-- historical_prop_closes: the last quote before kickoff per game, market,
--   player and book, from the Odds API historical per event snapshots
--   (prop history starts 2023-05-03). Same shape as player_props, plus the
--   nflverse season and week the kickoff falls in, so it joins
--   nfl_player_game_stats on (player_key, season, week) like the live
--   prop grader does.
-- historical_prop_results: one row per game, market and player on the
--   four over/under yardage and count markets plus passing TDs. The
--   consensus close is the line most books hang (ties to the lower line)
--   and the mean devigged over probability across those books, graded
--   against the nflverse stat line. The evidence base for the receptions
--   and pass TD publish decision. Anytime TD rows are stored but not in
--   the view (a yes price alone cannot be devigged).
-- historical_odds_jobs: the primary key gains markets, so the same sport
--   and month can hold a prop window and a game market window. NFL prop
--   windows are seeded for the regular season and playoff months from
--   September 2023 through October 2026 on the six markets the live sync
--   prices, priority 2 (after the soccer closes). About 60 credits a game.

create table if not exists public.historical_prop_closes (
  sport text not null,
  event_id text not null,
  commence_time timestamptz not null,
  home_team text,
  away_team text,
  season integer,
  week integer,
  market text not null,
  player_name text not null,
  player_key text not null,
  bookmaker text not null,
  line numeric,
  over_price integer,
  under_price integer,
  yes_price integer,
  snapshot_at timestamptz,
  quote_updated_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (event_id, market, player_key, bookmaker)
);
create index if not exists historical_prop_closes_player_week on public.historical_prop_closes (player_key, season, week);
create index if not exists historical_prop_closes_market_time on public.historical_prop_closes (market, commence_time);
alter table public.historical_prop_closes enable row level security;

create or replace view public.historical_prop_results
with (security_invoker = true) as
with book as (
  select h.*,
    case when h.over_price < 0 then -h.over_price::numeric / (100 - h.over_price) else 100::numeric / (h.over_price + 100) end as p_over,
    case when h.under_price < 0 then -h.under_price::numeric / (100 - h.under_price) else 100::numeric / (h.under_price + 100) end as p_under
  from public.historical_prop_closes h
  where h.market in ('player_pass_yds', 'player_pass_tds', 'player_rush_yds', 'player_reception_yds', 'player_receptions')
    and h.line is not null and h.over_price is not null and h.under_price is not null
),
lines as (
  select event_id, market, player_key, line,
    row_number() over (partition by event_id, market, player_key order by count(*) desc, line) as rk
  from book
  group by event_id, market, player_key, line
),
consensus as (
  select b.event_id, b.market, b.player_key,
    max(b.player_name) as player_name, max(b.sport) as sport, max(b.commence_time) as commence_time,
    max(b.home_team) as home_team, max(b.away_team) as away_team,
    max(b.season) as season, max(b.week) as week, b.line,
    count(*) as books,
    round(avg(b.p_over / (b.p_over + b.p_under)), 4) as close_over_prob
  from book b
  join lines l on l.event_id = b.event_id and l.market = b.market and l.player_key = b.player_key and l.line = b.line and l.rk = 1
  group by b.event_id, b.market, b.player_key, b.line
)
select c.*, s.team, s.opponent, s.position, a.actual,
  case
    when a.actual is null then null
    when a.actual > c.line then 'over'
    when a.actual < c.line then 'under'
    else 'push'
  end as result
from consensus c
left join public.nfl_player_game_stats s
  on s.player_key = c.player_key and s.season = c.season and s.week = c.week
cross join lateral (
  select case c.market
    when 'player_pass_yds' then s.passing_yards
    when 'player_pass_tds' then s.passing_tds
    when 'player_rush_yds' then s.rushing_yards
    when 'player_reception_yds' then s.receiving_yards
    when 'player_receptions' then s.receptions
  end::numeric as actual
) a;

alter table public.historical_odds_jobs drop constraint if exists historical_odds_jobs_pkey;
alter table public.historical_odds_jobs add primary key (sport, window_start, markets);

insert into public.historical_odds_jobs (sport, window_start, window_end, markets, priority)
select 'americanfootball_nfl', m::date, (m + interval '1 month')::date,
  'player_pass_yds,player_pass_tds,player_rush_yds,player_reception_yds,player_receptions,player_anytime_td', 2
from generate_series(date '2023-09-01', date '2026-10-01', interval '1 month') m
where extract(month from m) in (9, 10, 11, 12, 1, 2)
on conflict do nothing;
