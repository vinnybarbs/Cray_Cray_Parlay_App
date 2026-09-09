-- Daily point-in-time snapshot of tennis_rankings.
--
-- sync-tennis-data upserts tennis_rankings in place, so the table only
-- ever holds today's points. The Elo comeback replay run 2026-08-30 could
-- not be validated because of that: seeding player Elo from today's
-- ranking points leaks the very August results the replay was grading,
-- and the clean flat-seed control was negative at every blend weight.
--
-- One row per player per day, about 314 rows, makes a point-in-time
-- correct replay possible from this date forward. Day is America/Denver,
-- the only timezone allowed to produce a calendar day here.

create table if not exists public.tennis_rankings_history (
  snapshot_date date not null default (now() at time zone 'America/Denver')::date,
  tour text not null,
  player_key text not null,
  player_name text,
  rank integer,
  points numeric,
  captured_at timestamptz not null default now(),
  primary key (snapshot_date, tour, player_key)
);

create index if not exists idx_tennis_rankings_history_player
  on public.tennis_rankings_history (tour, player_key, snapshot_date);

-- No policies: this is worker-only data, read through the service role.
alter table public.tennis_rankings_history enable row level security;

-- Seed today so the series starts immediately.
insert into public.tennis_rankings_history
  (snapshot_date, tour, player_key, player_name, rank, points)
select (now() at time zone 'America/Denver')::date,
       tour, player_key, player_name, rank, points
from public.tennis_rankings
on conflict (snapshot_date, tour, player_key) do nothing;

-- Daily at 13:00 UTC, which is about an hour after the 12:05 UTC leg of
-- the tennis sync, so the snapshot lands on fresh points.
select cron.schedule('tennis_rankings_snapshot', '0 13 * * *', $job$
  insert into public.tennis_rankings_history
    (snapshot_date, tour, player_key, player_name, rank, points)
  select (now() at time zone 'America/Denver')::date,
         tour, player_key, player_name, rank, points
  from public.tennis_rankings
  on conflict (snapshot_date, tour, player_key) do nothing;
$job$);
