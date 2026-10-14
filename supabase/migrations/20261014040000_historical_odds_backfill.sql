-- Historical odds backfill (owner 2026-10-13: plan upgraded to 5M credits
-- a month, "Historical odds endpoint is live ... anything that would help
-- our data store?", then "All, in that order": soccer closes first, NFL
-- prop history second, multi season closes third).
--
-- historical_closing_lines: the last quote before kickoff per game, book
--   and market, from the Odds API historical snapshots (5 minutes apart).
--   Kept apart from closing_lines, which is the live capture CLV on real
--   picks reads, so a backfill can never move a pick's CLV.
-- historical_odds_jobs: the queue, one row per sport and month window.
--   /cron/backfill-historical-odds works it every 15 minutes, newest
--   windows first, until it is empty. Credits spent per window are on the
--   row (x-requests-last). Seeded here with the soccer windows: the eight
--   soccer keys back to August 2024 (MLS back to February 2025) on h2h and
--   totals. About 20 credits per distinct kickoff time.
-- The cron command reuses the sync-standings URL and secret from cron.job.

create table if not exists public.historical_closing_lines (
  sport text not null,
  external_game_id text not null,
  commence_time timestamptz not null,
  home_team text not null,
  away_team text not null,
  bookmaker text not null,
  market_type text not null,
  outcomes jsonb not null,
  snapshot_at timestamptz,
  quote_updated_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (external_game_id, bookmaker, market_type)
);
create index if not exists historical_closing_lines_sport_time on public.historical_closing_lines (sport, market_type, commence_time);
alter table public.historical_closing_lines enable row level security;

create table if not exists public.historical_odds_jobs (
  sport text not null,
  window_start date not null,
  window_end date not null,
  markets text not null,
  priority integer not null default 5,
  status text not null default 'pending',
  events integer,
  kickoffs integer,
  games_with_close integer,
  rows_written integer,
  credits_used integer,
  error text,
  started_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (sport, window_start)
);
alter table public.historical_odds_jobs enable row level security;

insert into public.historical_odds_jobs (sport, window_start, window_end, markets, priority)
select s.sport, m::date, (m + interval '1 month')::date, 'h2h,totals', 1
from (values
  ('soccer_epl', date '2024-08-01'),
  ('soccer_spain_la_liga', date '2024-08-01'),
  ('soccer_italy_serie_a', date '2024-08-01'),
  ('soccer_germany_bundesliga', date '2024-08-01'),
  ('soccer_france_ligue_one', date '2024-08-01'),
  ('soccer_uefa_champs_league', date '2024-09-01'),
  ('soccer_uefa_europa_league', date '2024-09-01'),
  ('soccer_usa_mls', date '2025-02-01')
) as s(sport, first_month)
cross join lateral generate_series(s.first_month, date '2026-10-01', interval '1 month') m
on conflict do nothing;

do $mig$
declare
  src text;
  cmd text;
begin
  if exists (select 1 from cron.job where jobname = 'backfill-historical-odds') then
    return;
  end if;
  select command into src from cron.job where jobname = 'sync-standings';
  if src is null then
    raise exception 'sync-standings cron job not found';
  end if;
  cmd := regexp_replace(src, '/cron/sync-standings', '/cron/backfill-historical-odds');
  cmd := regexp_replace(cmd, '&sports=[A-Za-z0-9,]*', '');
  if position('backfill-historical-odds' in cmd) = 0 then
    raise exception 'could not build backfill-historical-odds command';
  end if;
  perform cron.schedule('backfill-historical-odds', '*/15 * * * *', cmd);
end
$mig$;
