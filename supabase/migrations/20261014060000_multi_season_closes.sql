-- Multi season closes for the dial search (owner 2026-10-13, "All, in that
-- order": soccer closes, NFL prop history, then multi season closes).
--
-- historical_odds_jobs: monthly windows for NFL, NCAAF, MLB, NBA and NHL
--   from the 2023 seasons through the end of the 2025 seasons (NBA and
--   NHL through June 2026), on moneyline, spread and total, priority 3
--   (after the soccer and NFL prop windows). Rows land in
--   historical_closing_lines like the soccer closes. About 30 credits per
--   distinct kickoff time.
-- historical_game_results: ESPN finals for the same windows, synced by
--   the backfill runner after each window. Kept apart from game_results on
--   purpose: game_results feeds grading, and old finals must never meet a
--   pending pick.
-- game_results_with_history: game_results plus the historical finals ESPN
--   did not already give game_results. Only the replay reads it (history
--   mode), so a past season game sees the records, form and schedule its
--   teams had that morning.

create table if not exists public.historical_game_results (
  espn_event_id text primary key,
  sport text not null,
  date date not null,
  home_team_name text not null,
  away_team_name text not null,
  home_score integer not null,
  away_score integer not null,
  status text not null default 'final',
  created_at timestamptz not null default now()
);
create index if not exists historical_game_results_sport_date on public.historical_game_results (sport, date);
alter table public.historical_game_results enable row level security;

create or replace view public.game_results_with_history
with (security_invoker = true) as
select g.espn_event_id::text as espn_event_id, g.sport, g.date, g.home_team_name, g.away_team_name, g.home_score, g.away_score, g.status
from public.game_results g
union all
select h.espn_event_id, h.sport, h.date, h.home_team_name, h.away_team_name, h.home_score, h.away_score, h.status
from public.historical_game_results h
where not exists (select 1 from public.game_results g where g.espn_event_id::text = h.espn_event_id);

insert into public.historical_odds_jobs (sport, window_start, window_end, markets, priority)
select s.sport, m::date, (m + interval '1 month')::date, 'h2h,spreads,totals', 3
from (values
  ('americanfootball_nfl', date '2023-09-01', date '2026-02-01', array[9, 10, 11, 12, 1, 2]),
  ('americanfootball_ncaaf', date '2023-08-01', date '2026-01-01', array[8, 9, 10, 11, 12, 1]),
  ('baseball_mlb', date '2023-03-01', date '2025-11-01', array[3, 4, 5, 6, 7, 8, 9, 10, 11]),
  ('basketball_nba', date '2023-10-01', date '2026-06-01', array[10, 11, 12, 1, 2, 3, 4, 5, 6]),
  ('icehockey_nhl', date '2023-10-01', date '2026-06-01', array[10, 11, 12, 1, 2, 3, 4, 5, 6])
) as s(sport, first_month, last_month, months)
cross join lateral generate_series(s.first_month, s.last_month, interval '1 month') m
where extract(month from m)::int = any (s.months)
on conflict do nothing;
