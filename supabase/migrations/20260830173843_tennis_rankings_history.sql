-- HISTORICAL RECORD. Applied to production 2026-08-30 as version
-- 20260830173843 from the desktop project folder and never committed;
-- rescued from branch claude/restamp-pending-game-dates on 2026-09-09
-- and filed under its applied version so the repo matches production.
--
-- Daily point-in-time snapshot of tennis_rankings. sync-tennis-data
-- upserts tennis_rankings in place, so the table only ever holds
-- today's points. The Elo comeback replay run 2026-08-30 could not be
-- validated because of that: seeding player Elo from today's ranking
-- points leaks the very August results the replay was grading. One row
-- per player per day makes a point-in-time correct replay possible.
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

alter table public.tennis_rankings_history enable row level security;

-- Daily at 13:00 UTC, about an hour after the 12:05 UTC tennis sync.
select cron.schedule('tennis_rankings_snapshot', '0 13 * * *', $job$
  insert into public.tennis_rankings_history
    (snapshot_date, tour, player_key, player_name, rank, points)
  select (now() at time zone 'America/Denver')::date,
         tour, player_key, player_name, rank, points
  from public.tennis_rankings
  on conflict (snapshot_date, tour, player_key) do nothing;
$job$);
