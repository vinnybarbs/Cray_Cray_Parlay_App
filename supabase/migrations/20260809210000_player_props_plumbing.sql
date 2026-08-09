-- Player props storage (2026-08-09, football prep).
--
-- Props do not fit the h2h odds_cache shape: the unit is a player and a
-- stat line, not a team and a side. One row per (event, market, player,
-- book): the Over/Under prices ride together, and yes_price covers
-- yes/no markets like anytime TD. Consensus and edges are computed
-- downstream, this table is the raw market record. Grading joins
-- player_key to player_game_stats (ESPN boxscores) once the games
-- settle, the same key normalization tennis and UFC use.
--
-- Collection starts with NFL preseason so the props model has weeks of
-- line and outcome history before anything publishes. Shadow-first,
-- same as every other model: publish nothing until the readiness bar.

create table if not exists public.player_props (
  id bigint generated always as identity primary key,
  sport text not null default 'NFL',
  event_id text not null,
  commence_time timestamptz,
  home_team text,
  away_team text,
  market text not null,
  player_name text not null,
  player_key text not null,
  line numeric,
  over_price integer,
  under_price integer,
  yes_price integer,
  bookmaker text not null,
  last_updated timestamptz not null default now(),
  unique (event_id, market, player_key, bookmaker)
);

create index if not exists idx_player_props_event on public.player_props (event_id);
create index if not exists idx_player_props_player on public.player_props (player_key, market);
create index if not exists idx_player_props_commence on public.player_props (commence_time);

alter table public.player_props enable row level security;
drop policy if exists player_props_service on public.player_props;
create policy player_props_service on public.player_props
  for all to service_role using (true) with check (true);
